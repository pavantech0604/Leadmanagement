import type {User} from './types';
// Preserve the established local two-operator floor workspace boundary.
export function canTransfer(user:User){return user.role==='Admin'||user.id==='u1'&&user.role==='Manager'}
