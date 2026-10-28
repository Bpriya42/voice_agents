import { deck } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/** Masthead and chapter progress along the top edge of the live view. Decorative. */
export function LiveHeader() {
  const { view } = useSession();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <header className="live-head" aria-hidden="true">
      <span className="lh-brand">
        Ava <span className="lh-sep">—</span> <em>GLP-1 medicines</em>
      </span>
      <span className="lh-progress">
        {deck.map((s, i) => (
          <i
            key={s.id}
            className={i < view.slideIndex ? "done" : i === view.slideIndex ? "on" : ""}
          />
        ))}
      </span>
      <span className="lh-count">
        {pad(view.slideIndex + 1)} / {pad(deck.length)}
      </span>
    </header>
  );
}
