import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

interface NameEntryProps {
  name: string;
  onSubmit: (name: string) => void;
}

export function NameEntry({ name, onSubmit }: NameEntryProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h1>{t("app.title")}</h1>

      <label className="field">
        <span>{t("nameEntry.label")}</span>
        <input
          type="text"
          value={value}
          placeholder={t("nameEntry.placeholder")}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      </label>

      <button type="submit" disabled={!value.trim()}>
        {t("nameEntry.continueButton")}
      </button>
    </form>
  );
}
