import { personaById, slideById } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/** Shown while an answer jump has the stage away from the checkpoint slide (brief §7.4). */
export function StayHere() {
  const { view, controller } = useSession();
  if (!view.showStayHere) return null;
  const back = slideById(view.checkpoint.slideId).title;
  return (
    <div className="jump" role="status">
      <span>
        {personaById(view.persona).name} will return to “{back}”.
      </span>
      <button
        type="button"
        className="btn"
        onClick={() => controller.stayHere()}
        aria-keyshortcuts="S"
      >
        Stay here
      </button>
    </div>
  );
}
