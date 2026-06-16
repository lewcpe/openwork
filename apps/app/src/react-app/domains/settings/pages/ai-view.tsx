/** @jsxImportSource react */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { useLocal } from "@/react-app/kernel/local-provider";
import { readOpencodeConfig, writeOpencodeConfig } from "@/app/lib/desktop";
import { refreshProviderListQueries } from "@/react-app/infra/provider-list-query";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";

export type AiSettingsViewProps = {
  busy: boolean;
  openworkServerClient?: any;
  workspaceId?: string;
  workspaceRoot?: string;
};

export function AiSettingsView(props: AiSettingsViewProps) {
  const { prefs, setPrefs } = useLocal();
  const [baseUrl, setBaseUrl] = useState(prefs.aiBaseUrl ?? "https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState(prefs.aiApiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Keep local input fields in sync if preferences load/change asynchronously
  useEffect(() => {
    if (prefs.aiBaseUrl) setBaseUrl(prefs.aiBaseUrl);
    if (prefs.aiApiKey) setApiKey(prefs.aiApiKey);
  }, [prefs.aiBaseUrl, prefs.aiApiKey]);

  const handleSave = async () => {
    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();

    if (!trimmedUrl) {
      toast.error("Base URL is required");
      return;
    }

    try {
      // 1. Fetch the models list from the custom endpoint to register them in opencode
      let modelsObj: Record<string, { name: string }> = {};
      try {
        const url = `${trimmedUrl.replace(/\/$/, "")}/models`;
        const headers: Record<string, string> = {};
        if (trimmedKey) {
          headers["Authorization"] = `Bearer ${trimmedKey}`;
        }
        const res = await fetch(url, { headers });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            for (const item of json.data) {
              if (item && item.id) {
                modelsObj[item.id] = { name: item.id };
              }
            }
          }
        }
      } catch (err) {
        console.warn("Failed to fetch models during save (proceeding anyway):", err);
      }

      // 2. Update client-side preferences
      setPrefs((prev) => ({
        ...prev,
        aiBaseUrl: trimmedUrl,
        aiApiKey: trimmedKey || null,
      }));

      // 3. Sync variables to the backend EnvStore so OpenCode picks them up
      if (props.openworkServerClient) {
        const envVars = [
          { key: "OPENAI_BASE_URL", value: trimmedUrl },
          { key: "OPENAI_API_KEY", value: trimmedKey },
        ];
        await props.openworkServerClient.upsertUserEnv(envVars);
        
        // Notify of pending change reload if available
        if (typeof props.openworkServerClient.setUserEnvPendingChanges === "function") {
          await props.openworkServerClient.setUserEnvPendingChanges(true);
        }

        // 4. Patch workspace config to write to OPENCODE_CONFIG file (runtime-opencode-config.json)
        if (props.workspaceId && typeof props.openworkServerClient.patchConfig === "function") {
          await props.openworkServerClient.patchConfig(props.workspaceId, {
            opencode: {
              provider: {
                openai: null as any, // Clear any legacy openai custom provider overrides
                "custom-openai": {
                  id: "custom-openai",
                  npm: "@ai-sdk/openai-compatible",
                  name: "Custom AI Provider",
                  options: {
                    baseURL: trimmedUrl,
                  },
                  env: ["OPENAI_API_KEY"],
                  models: modelsObj,
                },
              },
            },
          });
        }
      }

      // 5. Clean up local workspace config file (opencode.json or opencode.jsonc) if available
      if (props.workspaceRoot) {
        try {
          const configRes = await readOpencodeConfig("project", props.workspaceRoot);
          if (configRes && configRes.content) {
            const parsed = JSON.parse(configRes.content);
            if (parsed) {
              parsed.provider = parsed.provider || {};
              // Clear any legacy custom provider overrides on openai
              delete parsed.provider.openai;
              
              // Write the new custom-openai configuration
              parsed.provider["custom-openai"] = {
                id: "custom-openai",
                npm: "@ai-sdk/openai-compatible",
                name: "Custom AI Provider",
                options: {
                  baseURL: trimmedUrl,
                },
                env: ["OPENAI_API_KEY"],
                models: modelsObj,
              };
              await writeOpencodeConfig("project", props.workspaceRoot, JSON.stringify(parsed, null, 2));
            }
          }
        } catch (e) {
          console.warn("Failed to clean local opencode.json config file:", e);
        }
      }

      toast.success("AI Configuration saved successfully!");
      void refreshProviderListQueries(getReactQueryClient());
    } catch (err) {
      console.error(err);
      toast.error("Failed to save configuration to the server.");
    }
  };

  const handleTestConnection = async () => {
    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();

    if (!trimmedUrl) {
      toast.error("Please enter a Base URL first.");
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const url = `${trimmedUrl.replace(/\/$/, "")}/models`;
      const headers: Record<string, string> = {};
      if (trimmedKey) {
        headers["Authorization"] = `Bearer ${trimmedKey}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const modelsCount = Array.isArray(data.data) ? data.data.length : 0;
      setTestResult({
        ok: true,
        message: `Successfully connected! Found ${modelsCount} available models.`,
      });
      toast.success("Connection test succeeded!");
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: `Failed to connect: ${err.message || String(err)}`,
      });
      toast.error("Connection test failed.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>AI Model Configuration</LayoutSectionTitle>
          <LayoutSectionDescription>
            Configure your single OpenAI-compatible base URL and API key. OpenWork will query this endpoint for available models and direct all LLM executions through it.
          </LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem className="flex flex-col gap-4 p-6 bg-dls-sidebar/20 border border-dls-border rounded-xl">
          <div className="space-y-2">
            <label className="text-sm font-medium text-dls-text">API Base URL</label>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm bg-background border border-dls-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              placeholder="e.g. https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={props.busy}
            />
            <p className="text-xs text-muted-foreground">
              The endpoint URL for the API (e.g. OpenRouter, Local Ollama, DeepSeek, or OpenAI).
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-dls-text">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                className="w-full pl-3 pr-10 py-2 text-sm bg-background border border-dls-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={props.busy}
              />
              <button
                type="button"
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-dls-text"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your secret key for authentication. Leave blank if the API endpoint does not require one.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={props.busy || testing}
            >
              Save Configuration
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={props.busy || testing}
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm mt-2 ${
                testResult.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </LayoutSectionItem>
      </LayoutSection>
    </LayoutStack>
  );
}
