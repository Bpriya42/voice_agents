/** The only file that knows OpenAI Realtime event names (arch §4.2). A rename is a one-line fix. */
export const SERVER = {
  responseCreated: "response.created",
  responseDone: "response.done",
  audioStarted: "output_audio_buffer.started",
  audioStopped: "output_audio_buffer.stopped",
  audioCleared: "output_audio_buffer.cleared",
  transcriptDelta: "response.output_audio_transcript.delta",
  transcriptDone: "response.output_audio_transcript.done",
  inputTranscriptDelta: "conversation.item.input_audio_transcription.delta",
  inputTranscriptDone: "conversation.item.input_audio_transcription.completed",
  inputCommitted: "input_audio_buffer.committed",
  speechStarted: "input_audio_buffer.speech_started",
  speechStopped: "input_audio_buffer.speech_stopped",
  toolArgsDone: "response.function_call_arguments.done",
  itemCreated: "conversation.item.created",
  error: "error",
} as const;

export const CLIENT = {
  responseCreate: "response.create",
  responseCancel: "response.cancel",
  audioClear: "output_audio_buffer.clear",
  inputClear: "input_audio_buffer.clear",
  inputCommit: "input_audio_buffer.commit",
  itemCreate: "conversation.item.create",
  itemDelete: "conversation.item.delete",
  sessionUpdate: "session.update",
} as const;

/** Expected protocol errors that are never shown (arch §6.2), only logged under ?debug=1. */
export const BENIGN_ERROR_CODES = new Set([
  "response_cancel_not_active",
  "input_audio_buffer_commit_empty",
]);
export const COMMIT_EMPTY_CODE = "input_audio_buffer_commit_empty";

export const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
export const DATA_CHANNEL = "oai-events";
