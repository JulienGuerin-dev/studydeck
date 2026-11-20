import { useState } from 'react'
import type { Folder, SubjectKind } from '../db/types'
import { setFolderStyle, setSubjectKind, KIND_LABEL, kindOf } from '../domain/subjects'
import { Modal, confirmAsk, levelAsk, toast } from './dialogs'

export const EMOJIS = ['📚', '🧮', '🔬', '🧪', '🧬', '🌍', '🏛️', '🗣️', '💻', '⚙️', '🎨', '🎵', '⚽', '🍳', '🌱', '🧠', '⚖️', '💼', '🩺', '✈️', '🦊', '🐙', '🦉', '🐢']
export const COLORS = ['#7c9cff', '#5ec4b6', '#f2a65a', '#ef7f8e', '#b58cf0', '#8fcf6b', '#e8c547', '#6fb7e6']

/** Change le type d'une matière en demandant l'étape de départ si elle repasse en apprentissage. */
export async function askChangeKind(f: Folder, next: SubjectKind): Promise<boolean> {
  const cur = kindOf(f)
  if (next === cur) return false
  try {
    if (next === 'learning') {
      const level = await levelAsk({
        title: `« ${f.name} » en apprentissage`,
        message: 'À quelle étape de l\'apprentissage vous situez-vous pour cette matière ?\nToutes ses cartes seront placées à cette étape (modifiable carte par carte ensuite).',
        okLabel: 'Passer en apprentissage',
      })
      if (level === null) return false
      await setSubjectKind(f.id, 'learning', level)
    } else {
      const ok = await confirmAsk({
        title: `Passer « ${f.name} » en ${KIND_LABEL[next].toLowerCase()} ?`,
        message: next === 'hobbit'
          ? 'Les cartes seront simplement consultées : plus de réussite/échec, plus de planification. Votre historique est conservé.'
          : 'La matière est classée comme apprise : ses cartes ne sont plus planifiées. Elle est rangée dans « Archives ».',
        okLabel: 'Confirmer',
      })
      if (!ok) return false
      await setSubjectKind(f.id, next)
    }
    toast(`Type modifié : ${KIND_LABEL[next]}`)
    return true
  } catch (e) { toast((e as Error).message, 'err'); return false }
}

/** Personnalisation d'un dossier : emoji, couleur et (pour une matière) type. */
export function StyleEditor({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const [emoji, setEmoji] = useState(folder.emoji ?? '')
  const [color, setColor] = useState(folder.color ?? '')
  const isRoot = folder.parentId === null

  const save = async () => {
    try { await setFolderStyle(folder.id, { emoji: [...emoji.trim()].slice(0, 2).join(''), color }); onClose() } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <Modal title={`Personnaliser « ${folder.name} »`} onClose={onClose}
      footer={<><button onClick={onClose}>Annuler</button><button className="primary" onClick={save}>Enregistrer</button></>}>
      <label className="field"><span>Emoji (posé sur la tête)</span>
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="Tapez ou choisissez un emoji" maxLength={8} />
      </label>
      <div className="emoji-grid">{EMOJIS.map((e) => <button key={e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)} aria-label={e}>{e}</button>)}</div>
      <div className="field"><span>Couleur</span></div>
      <div className="color-grid">
        <button className={!color ? 'on none' : 'none'} onClick={() => setColor('')} aria-label="Automatique">auto</button>
        {COLORS.map((c) => <button key={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
      </div>
      {isRoot && (
        <label className="field"><span>Type de matière</span>
          <select value={kindOf(folder)} onChange={async (e) => { if (await askChangeKind(folder, e.target.value as SubjectKind)) onClose() }}>
            {(Object.keys(KIND_LABEL) as SubjectKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
      )}
      {isRoot && <p className="muted small">Apprentissage : cycle de 6 étapes avec statistiques. Loisir : cartes simplement consultées, sans notation. Archive : matière terminée, rangée à part.</p>}
    </Modal>
  )
}
