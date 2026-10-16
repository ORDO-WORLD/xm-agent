'use client';

import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { matchingSections, nextSectionIndex, phoneSearchQuery, type SearchSection } from './section-search-utils';

type SearchContextValue = {
  query: string;
  currentId?: string;
  register: (section: SearchSection) => () => void;
  activeTab: string;
  toolbar: ReactNode;
};
const SearchContext = createContext<SearchContextValue | null>(null);
const TabContext = createContext('');

export function useSectionSearchQuery() {
  return useContext(SearchContext)?.query ?? '';
}

function textContent(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '';
  }).join('');
}

function highlight(node: ReactNode, query: string, current: boolean): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === 'string') {
      const parts: ReactNode[] = [];
      let offset = 0;
      let at = child.toLocaleLowerCase('id-ID').indexOf(query);
      while (at !== -1) {
        parts.push(child.slice(offset, at));
        parts.push(<mark key={at} className={current ? 'section-search-mark section-search-mark-current' : 'section-search-mark'}>{child.slice(at, at + query.length)}</mark>);
        offset = at + query.length;
        at = child.toLocaleLowerCase('id-ID').indexOf(query, offset);
      }
      parts.push(child.slice(offset));
      // Keep one inline item inside icon/title flex rows, so gaps cannot split a word.
      return <span>{parts}</span>;
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      return cloneElement(child, {}, highlight(child.props.children, query, current));
    }
    return child;
  });
}

/** Optional for shared panels: outside this provider headings render unchanged. */
export function useSectionSearchLabel(title: ReactNode, tabOverride?: string, phone?: string) {
  const search = useContext(SearchContext);
  const scopeTab = useContext(TabContext);
  const tab = tabOverride ?? scopeTab;
  const id = useId();
  const label = textContent(title);
  const register = search?.register;
  useEffect(() => {
    if (register && label) return register({ id, label, tab, phone });
  }, [register, id, label, tab, phone]);
  const highlightQuery = phone && search?.query ? phoneSearchQuery(search.query) || search.query : search?.query;
  if (phone && highlightQuery && typeof title === 'string') {
    // Map a numeric match back onto its formatted display, including spaces and dashes.
    const positions = [...title.matchAll(/\d/g)].map((match) => match.index);
    const digits = positions.map((position) => title[position]).join('');
    const at = digits.indexOf(highlightQuery);
    if (at >= 0) {
      const start = positions[at];
      const end = positions[at + highlightQuery.length - 1] + 1;
      return { id, content: <span>{title.slice(0, start)}<mark className={search?.currentId === id ? 'section-search-mark section-search-mark-current' : 'section-search-mark'}>{title.slice(start, end)}</mark>{title.slice(end)}</span> };
    }
  }
  return { id, content: highlightQuery ? highlight(title, highlightQuery, search?.currentId === id) : title };
}

export function SectionSearchScope({ tab, children }: { tab: string; children: ReactNode }) {
  return <TabContext.Provider value={tab}>{children}</TabContext.Provider>;
}

export function SettingsTabToolbar() {
  const search = useContext(SearchContext);
  const tab = useContext(TabContext);
  if (!search || (tab && search.activeTab !== tab)) return null;
  return <div className="settings-tab-toolbar">{search.toolbar}</div>;
}

export function SettingsSearchLayout({ activeTab, tabLabel, actions, children }: { activeTab: string; tabLabel: string; actions?: ReactNode; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState({ tab: activeTab, text: '' });
  const text = search.tab === activeTab ? search.text : '';
  const query = text.trim().toLocaleLowerCase('id-ID');
  const [sections, setSections] = useState<SearchSection[]>([]);
  const [selection, setSelection] = useState({ key: '', index: 0 });
  const register = useCallback((section: SearchSection) => {
    setSections((current) => [...current.filter((item) => item.id !== section.id), section].sort((a, b) => {
      const left = document.getElementById(a.id);
      const right = document.getElementById(b.id);
      return left && right ? (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1) : 0;
    }));
    return () => setSections((current) => current.filter((item) => item.id !== section.id));
  }, []);
  const matches = useMemo(() => matchingSections(sections, activeTab, query), [sections, activeTab, query]);
  const key = `${activeTab}:${query}`;
  const index = selection.key === key && matches.length ? selection.index % matches.length : 0;
  const currentId = matches[index]?.id;
  const move = (step: number) => {
    if (matches.length) setSelection({ key, index: nextSectionIndex(index, step, matches.length) });
  };

  if (search.tab !== activeTab) {
    setSearch({ tab: activeTab, text: '' });
    setSelection({ key: '', index: 0 });
  }

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!currentId) return;
    const heading = document.getElementById(currentId);
    const panel = heading?.closest<HTMLElement>('.tabs__panel');
    if (!heading || !panel) return;
    const top = panel.scrollTop + heading.getBoundingClientRect().top - panel.getBoundingClientRect().top - (panel.clientHeight - heading.offsetHeight) / 2;
    panel.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [currentId, query]);

  const toolbar = (
        <div className="settings-header-tools">
        {actions}
        <search aria-label={`Cari di tab ${tabLabel}`} className="settings-search">
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <input ref={input} type="text" value={text} onChange={(event) => { setSearch({ tab: activeTab, text: event.target.value }); setSelection({ key: '', index: 0 }); }}
            placeholder={`Cari di tab ${tabLabel}…`} aria-label={`Cari di tab ${tabLabel}`} aria-keyshortcuts="Control+f Meta+f"
            autoComplete="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
                event.preventDefault();
                move(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1);
              } else if (event.key === 'Escape') {
                setSearch({ tab: activeTab, text: '' });
                setSelection({ key: '', index: 0 });
              }
            }} />
          {text ? <>
            <output aria-live="polite" aria-atomic="true" aria-label={matches.length ? `Section ${index + 1} dari ${matches.length}` : 'Tidak ada section yang cocok'} className="shrink-0 whitespace-nowrap text-xs text-muted">{matches.length ? `${index + 1}/${matches.length}` : '0/0'}</output>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
            <button type="button" className="settings-search-action" aria-label="Section sebelumnya" title="Sebelumnya (↑)" disabled={!matches.length} onClick={() => move(-1)}><ChevronUp className="size-4" aria-hidden="true" /></button>
            <button type="button" className="settings-search-action" aria-label="Section berikutnya" title="Berikutnya (↓)" disabled={!matches.length} onClick={() => move(1)}><ChevronDown className="size-4" aria-hidden="true" /></button>
            <button type="button" className="settings-search-action" aria-label="Hapus pencarian" title="Hapus pencarian" onClick={() => { setSearch({ tab: activeTab, text: '' }); setSelection({ key: '', index: 0 }); input.current?.focus(); }}><X className="size-4" aria-hidden="true" /></button>
          </> : <kbd className="shrink-0 whitespace-nowrap text-xs font-normal text-muted">Ctrl + F</kbd>}
        </search>
        </div>
  );
  const value = { query, currentId, register, activeTab, toolbar };
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}
