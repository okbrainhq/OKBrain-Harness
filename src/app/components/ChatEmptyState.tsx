import { MapPin, MapPinOff, FileText, MessageSquare, Globe } from "lucide-react";
import React from 'react';
import HighlightsSection, { HighlightData } from "./HighlightsSection";
import { Button } from "./primitive/Button";
import styles from "./ChatEmptyState.module.css";
import { Conversation } from "./ChatView";
import { useChatContext } from "../context/ChatContext";

interface ChatEmptyStateProps {
    conversation: { title: string } | null | undefined;
    initialHighlightsData: HighlightData | null | undefined;
    onOpenLast: () => void;
    onTodayNews: () => void;
    isLoading: boolean;
    lastOpenedItem: { type: string; id: string } | null;
    conversationsCount: number;
}

export default function ChatEmptyState({
    conversation,
    initialHighlightsData,
    onOpenLast,
    onTodayNews,
    isLoading,
    lastOpenedItem,
    conversationsCount,
}: ChatEmptyStateProps) {
    const { location: locationContext } = useChatContext();

    return (
        <div className={`empty-state ${styles.emptyStateCustom}`}>
            <div className={styles.locationToggleContainer}>
                <button
                    className={`location-toggle-btn ${locationContext.isTrackingEnabled ? `active ${styles.locationToggleBtnActive}` : ''} ${styles.locationToggleBtn}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        locationContext.toggleTracking();
                    }}
                    title={locationContext.isTrackingEnabled ? "Location is ON. Click to turn off tracking." : "Location is OFF. Click to turn on tracking for local context."}
                >
                    {locationContext.isTrackingEnabled ? <MapPin size={20} /> : <MapPinOff size={20} />}
                </button>
            </div>
            {conversation?.title ? (
                <h2>{conversation.title}</h2>
            ) : null}

            <div className={styles.autoMarginBottom}>
                <HighlightsSection initialData={initialHighlightsData} />
                <div className={`home-action-buttons ${styles.homeActionButtons}`}>
                    <Button
                        onClick={onOpenLast}
                        icon={lastOpenedItem?.type === 'doc' ? <FileText size={14} /> : <MessageSquare size={14} />}
                        fullWidth={false}
                        disabled={(!lastOpenedItem && conversationsCount === 0) || isLoading}
                    >
                        Open Last
                    </Button>
                    <Button
                        onClick={onTodayNews}
                        icon={<Globe size={14} />}
                        fullWidth={false}
                        disabled={isLoading}
                    >
                        Today News
                    </Button>
                </div>
            </div>
        </div>
    );
}
