import { BookView } from "./BookView";
import { Chrome } from "./Chrome";
import { Colophon } from "./Colophon";
import { Contents } from "./Contents";
import { Welcome } from "./Welcome";
import { useFolio } from "../state/useFolio";

export function App() {
  const folio = useFolio();
  const chapterId = folio.pages[folio.nav.spread * 2]?.chapterId;
  const style = {
    ["--fs" as string]: `${folio.scale.fontSize}px`,
    ["--lh" as string]: `${folio.scale.lineHeight}px`,
    ["--drop-w" as string]: `${folio.scale.dropWidth}px`,
    ["--margin-x" as string]: `${folio.scale.marginX}px`,
  };

  return (
    <div className={`desk ${folio.reduced ? "reduced" : ""} ${folio.settings.justify ? "" : "ragged"}`} style={style}>
      <Chrome folio={folio} />
      {folio.notice ? (
        <p className="banner">
          {folio.noticeAction === "choose-model" ? (
            <button type="button" className="linkish banner-action" onClick={folio.openModels}>
              {folio.notice}
            </button>
          ) : (
            folio.notice
          )}{" "}
          <button type="button" className="linkish" onClick={folio.dismissNotice}>
            dismiss
          </button>
        </p>
      ) : null}
      <main className="stage">
        {folio.nav.view === "colophon" ? (
          <Colophon onClose={() => folio.closeColophon()} />
        ) : folio.nav.view === "contents" && folio.book ? (
          <Contents
            book={folio.book}
            chapterStart={folio.chapterStart}
            currentId={chapterId}
            onJump={(spread) => folio.jump(spread)}
          />
        ) : folio.nav.view === "reading" && folio.book ? (
          <BookView folio={folio} />
        ) : (
          <Welcome
            press={folio.press}
            modelLabel={folio.modelLabel}
            providerId={folio.providerId}
            onProvider={folio.setProviderId}
            providerKey={folio.providerKey}
            onKey={folio.setProviderKey}
            onSaveKey={() => void folio.saveProviderKey()}
            saving={folio.savingKey}
            onInstall={() => void folio.installPress()}
            onRetry={() => void folio.preparePress()}
            onOpenFolder={() => void folio.beginOpenFolder()}
            showPath={folio.showPath}
            pathDraft={folio.pathDraft}
            onPath={folio.setPathDraft}
            onConnect={() => void folio.connectPath()}
            pressUrl={folio.pressUrlDraft}
            onPressUrl={folio.setPressUrlDraft}
            passwordDraft={folio.passwordDraft}
            onPassword={folio.setPasswordDraft}
            onAttach={folio.attachPress}
            onSample={folio.openSample}
            onUseKey={() => void folio.showProviderForm()}
            onCloseKeys={folio.hideProviderForm}
          />
        )}
      </main>
    </div>
  );
}
