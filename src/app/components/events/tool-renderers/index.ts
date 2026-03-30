import { ReactNode } from 'react';

export interface ToolRendererProps {
  toolName: string;
  callContent: any;
  resultContent?: any;
  state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout';
  asyncJobId?: string;
  sinceSeq?: number;
  onStateChange?: (newState: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout') => void;
}

export type ToolRendererComponent = (props: ToolRendererProps) => ReactNode;

const registry: Record<string, ToolRendererComponent> = {};

export function registerToolRenderer(toolName: string, renderer: ToolRendererComponent) {
  registry[toolName] = renderer;
}

export function getToolRenderer(toolName: string): ToolRendererComponent | undefined {
  return registry[toolName];
}
