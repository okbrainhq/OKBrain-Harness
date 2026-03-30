"use client";

import { ReactNode } from "react";
import "./TabBar.module.css";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

interface TabBarProps<T extends string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  style?: React.CSSProperties;
}

export default function TabBar<T extends string>({ tabs, activeTab, onTabChange, style }: TabBarProps<T>) {
  return (
    <div className="tab-bar" style={style}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`tab-bar-item ${activeTab === tab.id ? 'tab-bar-item-active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
