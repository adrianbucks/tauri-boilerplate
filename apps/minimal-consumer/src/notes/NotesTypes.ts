export interface NoteRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  organisationId: string;
  syncGroupId: string;
  title: string;
  content: string;
  authorId: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteOperationId?: string | null;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  syncGroupId: string;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
}

