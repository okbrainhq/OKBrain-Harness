import { ChatProvider } from "../context/ChatContext";
import ChatLayout from "../components/ChatLayout";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getUserKV } from "@/lib/db";
import { getModelsConfig, isValidModelId } from "@/lib/ai";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Get models config from registry
  const modelsConfig = getModelsConfig();

  // Read sidebar collapsed state from cookies on the server
  const cookieStore = await cookies();
  const savedCollapsed = cookieStore.get('sidebarCollapsed')?.value;
  const initialCollapsed = savedCollapsed === 'true';

  // Fetch user preferences for SSR
  let initialAiProvider = modelsConfig.defaultModelId;
  let initialResponseMode: 'quick' | 'detailed' = 'detailed';
  let initialThinking = true;

  const session = await getSession();
  if (session) {
    const [aiProviderKV, responseModeKV, thinkingKV] = await Promise.all([
      getUserKV(session.userId, "chat:aiProvider"),
      getUserKV(session.userId, "chat:responseMode"),
      getUserKV(session.userId, "chat:thinking"),
    ]);

    if (aiProviderKV?.value && isValidModelId(aiProviderKV.value)) {
      initialAiProvider = aiProviderKV.value;
    }
    if (responseModeKV?.value && (responseModeKV.value === 'quick' || responseModeKV.value === 'detailed')) {
      initialResponseMode = responseModeKV.value;
    }
    if (thinkingKV?.value !== undefined) {
      initialThinking = thinkingKV.value === 'true';
    }
  }

  return (
    <ChatProvider
      modelsConfig={modelsConfig}
      initialSidebarCollapsed={initialCollapsed}
      initialAiProvider={initialAiProvider}
      initialResponseMode={initialResponseMode}
      initialThinking={initialThinking}
    >
      <ChatLayout>{children}</ChatLayout>
    </ChatProvider>
  );
}
