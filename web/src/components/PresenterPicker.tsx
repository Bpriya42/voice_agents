import { useEffect, useRef, useState } from "react";
import { PERSONAS, personaById, type PersonaId } from "@ava/shared";
import { useSession } from "../app/SessionProvider.js";

/**
 * Who presents (brief §6.1, §7.1): three voice cards. Tapping a card selects that presenter and
 * plays a short pre-recorded sample, never a live session; tapping the selected card replays it.
 * Underneath it is a native radio group, so arrow keys and screen readers work as usual.
 * It never blocks Check microphone.
 */
export function PresenterPicker() {
  const { view, choosePersona } = useSession();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<PersonaId | null>(null);
  const current = personaById(view.persona);

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
    // A missing clip or a blocked play is not an error: the cards still work.
    void a.play().catch(done);
  };

  return (
    <fieldset className="presenter" data-testid="presenter-picker">
      <legend className="label">Your presenter</legend>
      <div className="voice-cards">
        {PERSONAS.map((p) => {
          const selected = p.id === current.id;
          const isPlaying = playing === p.id;
          return (
            <label
              key={p.id}
              className="voice-card"
              data-selected={selected || undefined}
              data-playing={isPlaying || undefined}
            >
              {/* Clicks (and arrow keys, which click the newly checked radio) play the sample;
                  a click on the already-checked radio replays it. */}
              <input
                type="radio"
                name="presenter"
                value={p.id}
                checked={selected}
                aria-label={p.name}
                aria-describedby={`voice-tone-${p.id}`}
                onChange={() => choosePersona(p.id)}
                onClick={() => sample(p.id)}
              />
              <span className="voice-avatar" aria-hidden="true">
                {p.name[0]}
              </span>
              <span className="voice-name" aria-hidden="true">
                {p.name}
              </span>
              <span className="voice-tone" id={`voice-tone-${p.id}`}>
                {p.tone}
              </span>
              <span className="voice-state" aria-hidden="true">
                {isPlaying ? (
                  <>
                    <span className="eq">
                      <i />
                      <i />
                      <i />
                    </span>
                    Playing sample
                  </>
                ) : selected ? (
                  "Selected · tap to replay"
                ) : (
                  "Tap to hear"
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
