import { PERSONAS } from "@ava/shared";

/** Any presenter's name may lead the command ("Theo, end the presentation"). */
const NAMES = PERSONAS.map((p) => p.name.toLowerCase()).join("|");

const END_COMMAND = new RegExp(
  `^(?:(?:ok|okay|yes|yeah|ya|yep|sure|please|${NAMES}|so)\\s+)*` +
    "(?:(?:can|could|would|will) you\\s+)?(?:please\\s+)?" +
    "(?:end|stop|finish|close)" +
    "(?:\\s+(?:it|this|now|the|presentation|talk|session|demo|please))+$",
);

/**
 * A short, explicit request to end the talk ("end the presentation", "ya end it", "Theo, end the
 * presentation"). The whole utterance must be the command, so a question that only mentions ending
 * or stopping ("how does the treatment end?") never matches, and neither does a bare "stop".
 */
export function isEndCommand(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return END_COMMAND.test(t);
}
