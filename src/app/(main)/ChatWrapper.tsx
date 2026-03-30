"use client";

import EventChatView from "../components/events/EventChatView";
import { HighlightData } from "../components/HighlightsSection";

interface ChatWrapperProps {
  initialDocumentContexts?: { id: string; title: string }[] | null;
  initialContentContexts?: { title: string; content: string; sharedLinkId?: string }[] | null;
  initialAppId?: string | null;
  initialAppContext?: { id: string; title: string } | null;
  initialHighlightsData?: HighlightData | null;
  initialVerifyModel?: string | null;
}

export default function ChatWrapper({
  initialDocumentContexts,
  initialContentContexts,
  initialAppId,
  initialAppContext,
  initialHighlightsData,
  initialVerifyModel,
}: ChatWrapperProps) {
  return (
    <EventChatView
      initialDocumentContexts={initialDocumentContexts}
      initialContentContexts={initialContentContexts}
      initialAppId={initialAppId}
      initialAppContext={initialAppContext}
      initialHighlightsData={initialHighlightsData}
      initialVerifyModel={initialVerifyModel}
    />
  );
}
