import { create } from "zustand";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  streaming?: boolean;
  pinned?: boolean;
}

export type Persona =
  | "general"
  | "researcher"
  | "coder"
  | "creative"
  | "tutor"
  | "translator";

export interface PersonaInfo {
  id: Persona;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export const PERSONAS: PersonaInfo[] = [
  {
    id: "general",
    label: "General",
    description: "Versatile assistant for any task",
    icon: "🌐",
    color: "var(--atlas-lime)",
  },
  {
    id: "researcher",
    label: "Researcher",
    description: "Deep analysis and fact-checking",
    icon: "🔬",
    color: "var(--atlas-electric)",
  },
  {
    id: "coder",
    label: "Coder",
    description: "Code generation and debugging",
    icon: "⌨️",
    color: "var(--atlas-neon-green)",
  },
  {
    id: "creative",
    label: "Creative",
    description: "Writing, brainstorming, ideation",
    icon: "🎨",
    color: "var(--atlas-gold)",
  },
  {
    id: "tutor",
    label: "Tutor",
    description: "Step-by-step explanations",
    icon: "📚",
    color: "var(--atlas-amber)",
  },
  {
    id: "translator",
    label: "Translator",
    description: "Multi-language translation",
    icon: "🌍",
    color: "var(--atlas-racing-green)",
  },
];

interface AIChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  persona: Persona;
  panelWidth: number;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setPersona: (p: Persona) => void;
  addMessage: (role: ChatRole, content: string) => string;
  updateMessage: (id: string, content: string) => void;
  setStreaming: (id: string, streaming: boolean) => void;
  togglePin: (id: string) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setPanelWidth: (w: number) => void;
}

let nextId = 0;
function genId(): string {
  return `msg_${Date.now()}_${++nextId}`;
}

export const useAIChatStore = create<AIChatState>((set) => ({
  isOpen: false,
  messages: [],
  persona: "general",
  panelWidth: 420,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setPersona: (persona) => set({ persona }),

  addMessage: (role, content) => {
    const id = genId();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role, content, timestamp: Date.now(), streaming: false },
      ],
    }));
    return id;
  },

  updateMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),

  setStreaming: (id, streaming) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming } : m,
      ),
    })),

  togglePin: (id) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, pinned: !m.pinned } : m,
      ),
    })),

  removeMessage: (id) =>
    set((s) => ({
      messages: s.messages.filter((m) => m.id !== id),
    })),

  clearMessages: () => set({ messages: [] }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),
}));
