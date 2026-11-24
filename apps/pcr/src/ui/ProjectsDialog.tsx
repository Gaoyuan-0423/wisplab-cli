import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import type { ProjectMeta } from '../core/projects';

interface Props {
  currentId: string | null;
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onNew: () => void;
}

function timeLabel(ts: number, language: string): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `今天 ${d.toLocaleTimeString(language === 'en' ? 'en' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString(language === 'en' ? 'en' : 'zh-CN', { month: 'numeric', day: 'numeric' });
}

/** 我的课题：已保存课题列表（打开 / 重命名 / 删除）。 */
export default function ProjectsDialog({
  currentId,
  projects,
  onOpen,
  onRename,
  onDelete,
  onClose,
  onNew,
}: Props) {
  const { t, language } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // 打开时清空临时编辑态
  useEffect(() => {
    setRenaming(null);
    setConfirmDelete(null);
  }, [projects]);

  return (
    <div className="modal-overlay" role="dialog" aria-label={t("我的课题")} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h3>{t("我的课题")}</h3>
          <span className="hint-line" style={{ margin: 0 }}>{t('{0} 个已保存', [projects.length])}</span>
          <span style={{ flex: 1 }} />
          <button className="small" onClick={onNew}>
            {t("＋ 新建课题")}</button>
        </div>
        {projects.length === 0 ? (
          <p className="empty-note">{t("还没有保存的课题。完成一次分析后会自动保存到这里。")}</p>
        ) : (
          <div className="project-list">
            {projects.map((p) => (
              <div className={`project-row ${p.id === currentId ? 'project-current' : ''}`} key={p.id}>
                {renaming === p.id ? (
                  <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                    <input
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft.trim()) {
                          onRename(p.id, draft.trim());
                          setRenaming(null);
                        }
                      }}
                      aria-label={t("课题名称")}
                    />
                    <button
                      className="small primary"
                      onClick={() => {
                        if (draft.trim()) onRename(p.id, draft.trim());
                        setRenaming(null);
                      }}
                    >
                      {t("保存")}</button>
                    <button className="small" onClick={() => setRenaming(null)}>
                      {t("取消")}</button>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1 }}>
                      <div>
                        <strong>{p.name}</strong>
                        {p.id === currentId && <span className="tag-current">{t("当前")}</span>}
                        {p.score != null && (
                          <span className="hint-line" style={{ display: 'inline', marginLeft: 8 }}>
                            {t("质量分")}{' '}{p.score}
                          </span>
                        )}
                      </div>
                      <div className="hint-line" style={{ margin: 0 }}>
                        {t(timeLabel(p.updatedAt, language))} · {p.rows} {' '}{t("行数据 ·")}{' '}{p.fileName || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="small primary" onClick={() => onOpen(p.id)}>
                        {t("打开")}</button>
                      <button
                        className="small"
                        onClick={() => {
                          setRenaming(p.id);
                          setDraft(p.name);
                        }}
                      >
                        {t("重命名")}</button>
                      {confirmDelete === p.id ? (
                        <>
                          <button className="small danger" onClick={() => { onDelete(p.id); setConfirmDelete(null); }}>
                            {t("确认删除")}</button>
                          <button className="small" onClick={() => setConfirmDelete(null)}>
                            {t("取消")}</button>
                        </>
                      ) : (
                        <button className="small danger" onClick={() => setConfirmDelete(p.id)}>
                          {t("删除")}</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>{t("关闭")}</button>
        </div>
      </div>
    </div>
  );
}
