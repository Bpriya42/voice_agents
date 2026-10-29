import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PERSONAS, personaById, type PersonaId } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/**
 * Who presents (brief §6.1, §7.1): a radio group styled as a three-stop slider, so arrow keys and
 * screen readers work natively. Choosing plays a short pre-recorded sample, never a live session.
 * It never blocks Check microphone.
 */
export function PresenterPicker() {
  const { view, choosePersona } = useSession();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<PersonaId | null>(null);
  const current = personaById(view.persona);
  const stop = PERSONAS.findIndex((p) => p.id === current.id);

  // Leaving the landing page stops a sample mid-play.
  useEffect(() => () => audio.current?.pause(), []);

  const sample = (id: PersonaId) => {
    audio.current?.pause();
    const a = new Audio(`/voices/${id}.mp3`);
    audio.current = a;
    setPlaying(id);
    const done = () => setPlaying((p) => (p === id ? null : p));
    a.onended = done;
    a.onerror = done;
    // A missing clip or a blocked play is not an error: the picker still works.
    void a.play().catch(done);
  };

  return (
    <fieldset className="presenter" data-testid="presenter-picker">
      <legend className="label">Your presenter</legend>
      <div className="presenter-track" style={{ "--stop": stop } as CSSProperties}>
        <span className="presenter-pill" aria-hidden="true" />
        {PERSONAS.map((p) => (
          <label key={p.id} className={p.id === current.id ? "on" : undefined}>
            <input
              type="radio"
              name="presenter"
              value={p.id}
              checked={p.id === current.id}
              aria-label={p.name}
              aria-describedby={`presenter-tone-${p.id}`}
              onChange={() => {
                choosePersona(p.id);
                sample(p.id);
              }}
            />
            <span className="presenter-name" aria-hidden="true">
              {p.name}
            </span>
            <span className="presenter-tone" id={`presenter-tone-${p.id}`}>
              {p.tone}
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="btn link presenter-hear"
        aria-pressed={playing === current.id}
        onClick={() => sample(current.id)}
      >
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Hear {current.name}
      </button>
    </fieldset>
  );
}
