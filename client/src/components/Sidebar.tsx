import type { ConversationDTO } from '../../../shared/types';
import { groupConversations } from '../format';

interface Props {
  conversations: ConversationDTO[];
  activeId: string;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function Sidebar({ conversations, activeId, open, onSelect, onNew, onDelete, onClose }: Props) {
  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Conversations">
        <div className="sidebar-head">
          <span className="brand">Minimi</span>
          <button className="ghost" onClick={onNew}>New chat</button>
        </div>
        <nav>
          {conversations.length === 0 && <p className="muted small pad">No conversations yet.</p>}
          {groupConversations(conversations).map((group) => (
            <section key={group.label}>
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((c) => (
                  <li key={c.id} className={c.id === activeId ? 'active' : ''}>
                    <button className="conv" onClick={() => onSelect(c.id)} title={c.title}>
                      {c.title}
                    </button>
                    <button className="delete" aria-label={`Delete ${c.title}`} onClick={() => onDelete(c.id)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>
    </>
  );
}
