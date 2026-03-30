import { ShieldCheck, FileText, ChevronDown, Check } from "lucide-react";
import { Button } from "./primitive/Button";
import styles from "./ChatActions.module.css";
import { useChatContext } from "../context/ChatContext";

interface ChatActionsProps {
    onSummarize: () => void;
    onVerify: () => void;
    verifyModel: string;
    onVerifyModelChange: (model: string) => void;
    showVerifyMenu: boolean;
    setShowVerifyMenu: (show: boolean) => void;
}

export default function ChatActions({
    onSummarize,
    onVerify,
    verifyModel,
    onVerifyModelChange,
    showVerifyMenu,
    setShowVerifyMenu,
}: ChatActionsProps) {
    const { modelsConfig } = useChatContext();

    const getModelName = (modelId: string) => {
        return modelsConfig.models.find(m => m.id === modelId)?.name ?? modelId;
    };

    return (
        <div className={`action-container ${styles.actionContainer}`}>
            <Button
                onClick={onSummarize}
                className="summarize-button"
                icon={<FileText size={14} />}
                fullWidth={false}
            >
                Summarize
            </Button>
            <div className={styles.verifyGroup}>
                <div className={`verify-split-button ${styles.verifySplitButton}`}>
                    <Button
                        onClick={onVerify}
                        className={`verify-button-main ${styles.verifyButtonMainOverride}`}
                        icon={<ShieldCheck size={14} />}
                        fullWidth={false}
                        title={`Verify with ${getModelName(verifyModel)}`}
                    >
                        Verify with {getModelName(verifyModel)}
                    </Button>
                    <button
                        onClick={() => setShowVerifyMenu(!showVerifyMenu)}
                        className={`verify-button-arrow ${styles.verifyButtonArrow}`}
                    >
                        <ChevronDown size={14} />
                    </button>

                    {showVerifyMenu && (
                        <>
                            <div
                                className={`menu-overlay ${styles.menuOverlay}`}
                                onClick={() => setShowVerifyMenu(false)}
                            />
                            <div className={`verify-menu-dropdown ${styles.verifyMenuDropdown}`}>
                                {modelsConfig.models.map((model) => (
                                    <button
                                        key={model.id}
                                        onClick={() => {
                                            onVerifyModelChange(model.id);
                                            setShowVerifyMenu(false);
                                        }}
                                        className={styles.verifyMenuItem}
                                    >
                                        <span>{model.name}</span>
                                        {verifyModel === model.id && <Check size={14} className={styles.verifyMenuCheck} />}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
