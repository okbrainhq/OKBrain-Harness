import { getSharedLink, getConversation, getChatEvents, getDocument, getSnapshotById } from "@/lib/db";
import { notFound } from "next/navigation";
import SharedConversationView from "@/app/components/SharedConversationView";
import SharedDocumentView from "@/app/components/SharedDocumentView";
import { Metadata } from "next";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sharedLink = await getSharedLink(id);

  if (!sharedLink) return { title: "Not Found" };

  let title = "Shared Content";
  if (sharedLink.type === 'conversation') {
    const conv = await getConversation(sharedLink.user_id, sharedLink.resource_id);
    if (conv) title = conv.title;
  } else if (sharedLink.type === 'snapshot') {
    const snap = await getSnapshotById(sharedLink.resource_id);
    if (snap) title = snap.title;
  } else {
    const doc = await getDocument(sharedLink.user_id, sharedLink.resource_id);
    if (doc) title = doc.title;
  }

  return {
    title: `${title} | Shared on OkBrain`,
    description: `Publicly shared ${sharedLink.type} from OkBrain AI Assistant`,
  };
}

export default async function SharedPage({ params }: Props) {
  const { id } = await params;
  const sharedLink = await getSharedLink(id);

  if (!sharedLink) {
    notFound();
  }

  if (sharedLink.type === 'conversation') {
    const conversation = await getConversation(sharedLink.user_id, sharedLink.resource_id);

    if (!conversation) notFound();

    // Load chat events and transform for shared view
    const chatEvents = await getChatEvents(sharedLink.resource_id);
    const safeMessages = chatEvents
      .filter(e => e.kind === 'user_message' || e.kind === 'assistant_text' || e.kind === 'summary')
      .map(e => {
        let content: any;
        try { content = typeof e.content === 'string' ? JSON.parse(e.content) : e.content; } catch { content = e.content; }
        return {
          id: e.id,
          role: (e.kind === 'user_message' ? 'user' : e.kind === 'summary' ? 'summary' : 'assistant') as 'user' | 'assistant' | 'summary',
          content: content.text || '',
          model: content.model,
          sources: undefined,
          wasGrounded: content.was_grounded || false,
          thoughts: undefined as string | undefined,
          thinking_duration: undefined as number | undefined,
          created_at: e.created_at,
        };
      });

    // Load linked source shared link if present
    const linkedSharedLinks: { sharedLinkId: string; title: string }[] = [];
    if (conversation.source_shared_link_id) {
      const sourceLink = await getSharedLink(conversation.source_shared_link_id);
      if (sourceLink) {
        let title = 'Shared Content';
        if (sourceLink.type === 'document') {
          const doc = await getDocument(sourceLink.user_id, sourceLink.resource_id);
          if (doc) title = doc.title;
        } else if (sourceLink.type === 'snapshot') {
          const snap = await getSnapshotById(sourceLink.resource_id);
          if (snap) title = snap.title;
        } else if (sourceLink.type === 'conversation') {
          const conv = await getConversation(sourceLink.user_id, sourceLink.resource_id);
          if (conv) title = conv.title;
        }
        linkedSharedLinks.push({ sharedLinkId: conversation.source_shared_link_id, title });
      }
    }

    return (
      <main style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg-primary)', WebkitOverflowScrolling: 'touch' }}>
        <SharedConversationView
          title={conversation.title}
          messages={safeMessages}
          sharedLinkId={id}
          linkedSharedLinks={linkedSharedLinks}
        />
      </main>
    );
  } else if (sharedLink.type === 'snapshot') {
    const snapshot = await getSnapshotById(sharedLink.resource_id);

    if (!snapshot) notFound();

    return (
      <main style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg-primary)', WebkitOverflowScrolling: 'touch' }}>
        <SharedDocumentView
          title={snapshot.title}
          content={snapshot.content}
          snapshotMessage={snapshot.message}
          snapshotDate={snapshot.created_at}
          sharedLinkId={id}
        />
      </main>
    );
  } else {
    const document = await getDocument(sharedLink.user_id, sharedLink.resource_id);

    if (!document) notFound();

    return (
      <main style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg-primary)', WebkitOverflowScrolling: 'touch' }}>
        <SharedDocumentView
          title={document.title}
          content={document.content}
          sharedLinkId={id}
        />
      </main>
    );
  }
}
