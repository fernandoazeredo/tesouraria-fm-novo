import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { pendingPermissionDocId, type PermissionDocument } from './permissionCatalog'

/**
 * Permissões que o Fernando configurou antes do primeiro acesso ficam em userPermissions/email:<e-mail>.
 * Quando a pessoa já existe em users e ainda não tem userPermissions/<uid>, copia para o uid (executado pelo Master).
 */
export async function migratePendingPermissions(masterUid: string) {
  const users = await getDocs(collection(db, 'users'))
  let moved = 0
  for (const user of users.docs) {
    const email = String(user.data().email || '').trim().toLowerCase()
    if (!email) continue
    const pending = await getDoc(doc(db, 'userPermissions', pendingPermissionDocId(email)))
    if (!pending.exists()) continue
    const current = await getDoc(doc(db, 'userPermissions', user.id))
    if (current.exists()) continue
    const data = pending.data() as PermissionDocument
    const batch = writeBatch(db)
    batch.set(doc(db, 'userPermissions', user.id), { schemaVersion: 1, modules: data.modules || {}, updatedBy: masterUid, updatedAt: serverTimestamp() })
    await batch.commit()
    moved++
  }
  return moved
}
