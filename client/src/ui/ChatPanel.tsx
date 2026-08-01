import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CHAT_CHANNEL, MAX_CHAT_LENGTH, type ChatMessage } from "@foghaven/shared";
import { Button, Panel } from "./primitives";

interface ChatPanelProps {
  messages: ChatMessage[];
  /** Ghosts always have their channel open; the living only during meetings. */
  canSend: boolean;
  isGhost: boolean;
  onSend: (text: string) => void;
}

/**
 * The meeting chat log and composer.
 *
 * Every message here arrived on this client's own socket, and the server only
 * ever sends a line to clients on the sender's side of the living/dead split
 * (see `GameRoom.handleChat`). So there is no filtering to do here — a living
 * player's copy of `messages` simply never contains dead chat.
 */
export function ChatPanel({ messages, canSend, isGhost, onSend }: ChatPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      return;
    }
    onSend(text);
    setDraft("");
  };

  return (
    <Panel className={`chat-panel ${isGhost ? "chat-panel-dead" : ""}`}>
      <h2>{isGhost ? t("chat.deadHeading") : t("chat.heading")}</h2>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && <p className="hint">{t("chat.empty")}</p>}
        {messages.map((message) => (
          <p key={message.id} className="chat-line">
            <span
              className={
                message.channel === CHAT_CHANNEL.DEAD ? "chat-sender chat-sender-dead" : "chat-sender"
              }
            >
              {message.senderName}
            </span>
            <span className="chat-text">{message.text}</span>
          </p>
        ))}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={canSend ? t("chat.placeholder") : t("chat.closed")}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canSend}
        />
        <Button type="submit" variant="primary" disabled={!canSend || draft.trim() === ""}>
          {t("chat.sendButton")}
        </Button>
      </form>
    </Panel>
  );
}
