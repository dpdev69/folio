import { useEffect, useRef, useState } from "react";
import type { EngineClient, ModelInfo, ModelRef, ProviderInfo } from "../engine/client";
import { licenseBlocks, uncheckedLicense } from "../license/check";
import { keyProviders, pressSummary, type PressPhase } from "../welcome/copy";
import {
  loadChosenModel,
  messageOf,
  offeredModels,
  openPress,
  pressHost,
  reattachPress,
  saveChosenModel,
  type AttachTarget,
} from "./press";
import { afterRestart, generations, openGate, restartWait, steadyGate } from "./restart";

export type EngineState = "off" | "connecting" | "ready" | "error";

export type PressDeps = {
  setNotice: (notice: string | null) => void;
  /** Whether the open book's stream is in an outage. */
  isPaused: () => boolean;
  /** A press is about to be found or attached: the open book's stream stops. */
  onDetach: () => void;
  /** A new client reaches the press: listen to it for the open book, and read the book again. */
  onAttached: (client: EngineClient) => void;
};

/**
 * The press behind the book: find it, start or attach to it, start it again
 * when it stops answering, and the model and provider key it writes with.
 */
export function usePress(deps: PressDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [press, setPress] = useState<PressPhase>({ phase: "checking" });
  const [providerId, setProviderId] = useState("openai");
  const [providerKey, setProviderKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [engineState, setEngineState] = useState<EngineState>("off");
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [pressUrlDraft, setPressUrlDraft] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const clientRef = useRef<EngineClient | null>(null);
  const providersRef = useRef<ProviderInfo[]>([]);
  // The attach target to reach the press with, whether it is being started again, and when it may be next.
  const targetRef = useRef<AttachTarget | undefined>(undefined);
  // The press generation a restart is in flight for, if any.
  const restartingRef = useRef<number | null>(null);
  // Moves on each time preparePress sets out for a press; work for an earlier one is let go when it lands.
  const [gens] = useState(generations);
  // The generation preparePress is still opening; no restart goes to the press being left meanwhile.
  const preparingRef = useRef<number | null>(null);
  const gateRef = useRef(openGate());
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearRestartTimer() {
    if (restartTimer.current != null) clearTimeout(restartTimer.current);
    restartTimer.current = null;
  }

  // A restart waiting out its backoff is not left to fire after Folio has gone.
  useEffect(() => () => clearRestartTimer(), []);

  /** The stream has held: the next restart, if one is needed, may go at once. */
  function steady() {
    gateRef.current = steadyGate(gateRef.current, Date.now());
    clearRestartTimer();
  }

  function adopt(client: EngineClient) {
    client.onUnreachable = whenUnreachable;
    client.onSteady = steady;
    clientRef.current = client;
  }

  /** Find the press, start or attach to it, and say on the title page what it will write with. */
  async function preparePress(target?: AttachTarget) {
    const generation = gens.next();
    preparingRef.current = generation;
    // The open book's stream belongs to the press being left.
    depsRef.current.onDetach();
    clearRestartTimer();
    gateRef.current = openGate();
    setPress({ phase: "checking" });
    try {
      const license = await uncheckedLicense.check();
      if (!gens.isCurrent(generation)) return;
      if (licenseBlocks(license)) {
        setPress({ phase: "error", message: "This copy of Folio is not licensed." });
        return;
      }
      const opened = await openPress(pressHost(), target, loadChosenModel());
      // A later preparePress has set out for another press: this one is let go.
      if (!gens.isCurrent(generation)) return;
      targetRef.current = target;
      if (opened.client) adopt(opened.client);
      else clientRef.current = null;
      providersRef.current = opened.providers;
      setProviders(opened.providers);
      setModels(opened.models);
      setModel(opened.model);
      setEngineState(opened.client ? "ready" : "off");
      setEngineVersion(opened.version ?? null);
      setPress(opened.phase);
      if (opened.client) depsRef.current.onAttached(opened.client);
    } catch (error) {
      if (!gens.isCurrent(generation)) return;
      clientRef.current = null;
      setEngineState("error");
      setPress({ phase: "error", message: messageOf(error, "The press could not be reached.") });
    } finally {
      if (preparingRef.current === generation) preparingRef.current = null;
    }
  }

  async function installPress() {
    setPress({ phase: "installing" });
    try {
      const result = await pressHost().install();
      if (!result.ok) {
        setPress({ phase: "missing", detail: result.error ?? "The installer did not finish." });
        return;
      }
      await preparePress();
    } catch (error) {
      setPress({ phase: "missing", detail: messageOf(error, "The installer did not finish.") });
    }
  }

  /**
   * The stream keeps failing, or a call found nothing answering while it was
   * paused: the press may have died. Reach it again (the host starts a new one,
   * with a new port and password), listen with the new client, and resync.
   * Restarts back off until a stream holds; if one fails, the old stream goes
   * on trying and asks again later.
   */
  async function restartPress() {
    const generation = gens.current();
    if (restartingRef.current === generation || preparingRef.current === generation) return;
    const wait = restartWait(gateRef.current, Date.now());
    if (wait > 0) {
      if (restartTimer.current == null) {
        restartTimer.current = setTimeout(() => {
          restartTimer.current = null;
          void restartPress();
        }, wait);
      }
      return;
    }
    restartingRef.current = generation;
    gateRef.current = afterRestart(gateRef.current, Date.now());
    try {
      const client = await reattachPress(pressHost(), targetRef.current);
      // preparePress switched presses while this restart was out: its client belongs to the press left behind.
      if (!gens.isCurrent(generation)) return;
      adopt(client);
      depsRef.current.onAttached(client);
      depsRef.current.setNotice(null);
    } catch {
      if (gens.isCurrent(generation)) depsRef.current.setNotice("The press is not answering. Folio will keep trying.");
    } finally {
      if (restartingRef.current === generation) restartingRef.current = null;
    }
  }

  function whenUnreachable() {
    if (depsRef.current.isPaused()) void restartPress();
  }

  /** Remember the reader's model and name it on the title page. */
  function pickModel(choice: ModelRef) {
    setModel(choice);
    saveChosenModel(choice);
    setPress((current) =>
      current.phase === "ready"
        ? { ...current, summary: pressSummary(current.version, providersRef.current, choice), note: undefined }
        : current,
    );
  }

  /** Store a provider key with the press, then name the press's model again. */
  async function saveProviderKey() {
    const client = clientRef.current;
    if (!providerKey.trim() || !client) return;
    setSavingKey(true);
    try {
      await client.connectKey(providerId, providerKey.trim(), "Folio");
      setProviderKey("");
      const [providers, list, fallback] = await Promise.all([
        client.providers().catch(() => providersRef.current),
        client.models().catch(() => [] as ModelInfo[]),
        client.defaultModel().catch(() => null),
      ]);
      providersRef.current = providers;
      setProviders(providers);
      setModels(offeredModels(list));
      const chosen = model ?? (fallback ? { providerID: fallback.providerID, id: fallback.id } : null);
      setPress((current) =>
        current.phase === "ready"
          ? { phase: "ready", version: current.version, summary: pressSummary(current.version, providers, chosen) }
          : current,
      );
    } catch (error) {
      depsRef.current.setNotice(messageOf(error, "The key was not accepted."));
    } finally {
      setSavingKey(false);
    }
  }

  /** Open the key form on the title page. It is never required; the free provider works without one. */
  async function showProviderForm() {
    const client = clientRef.current;
    if (!client) {
      depsRef.current.setNotice("The press is not ready yet.");
      return;
    }
    const list = keyProviders(await client.integrations().catch(() => []));
    if (!list.length) {
      depsRef.current.setNotice("The press offers no providers that take a key.");
      return;
    }
    if (!list.some((item) => item.id === providerId)) setProviderId(list[0].id);
    setPress((current) => (current.phase === "ready" ? { ...current, providers: list } : current));
  }

  function hideProviderForm() {
    setPress((current) => (current.phase === "ready" ? { ...current, providers: undefined } : current));
  }

  return {
    clientRef,
    press,
    providerId,
    setProviderId,
    providerKey,
    setProviderKey,
    savingKey,
    engineState,
    setEngineState,
    engineVersion,
    passwordDraft,
    setPasswordDraft,
    pressUrlDraft,
    setPressUrlDraft,
    models,
    model,
    providers,
    preparePress,
    installPress,
    restartPress,
    pickModel,
    saveProviderKey,
    showProviderForm,
    hideProviderForm,
  };
}
