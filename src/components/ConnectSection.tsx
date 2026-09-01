import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";

const clients = {
  codex: {
    label: "Codex",
    command:
      "DISABLE_TELEMETRY=1 npx skills add rohanarun/tensor-book --global --agent codex --yes",
  },
  claude: {
    label: "Claude Code",
    command:
      "DISABLE_TELEMETRY=1 npx skills add rohanarun/tensor-book --global --agent claude-code --yes",
  },
};

type ClientKey = keyof typeof clients;

export function InstallBar() {
  const [client, setClient] = useState<ClientKey>("codex");
  const [copied, setCopied] = useState(false);
  const current = clients[client];

  async function copy() {
    await navigator.clipboard?.writeText(current.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <header className="install-bar" aria-label="Install Tensor Book">
      <div className="install-bar-inner wide-container">
        <div className="install-identity">
          <strong>tensor-book</strong>
          <span>Install with npx</span>
        </div>
        <div className="install-tabs" role="tablist" aria-label="Choose an agent">
          {(Object.keys(clients) as ClientKey[]).map((key) => (
            <button
              type="button"
              role="tab"
              aria-selected={client === key}
              className={client === key ? "active" : ""}
              onClick={() => setClient(key)}
              key={key}
            >
              {clients[key].label}
            </button>
          ))}
        </div>
        <div className="install-command">
          <code>{current.command}</code>
          <button type="button" onClick={copy} aria-label={`Copy ${current.label} install command`}>
            {copied ? <Check size={18} weight="bold" /> : <Copy size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}
