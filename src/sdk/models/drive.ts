export interface Repository {
    repoId: string;
    name: string;
    originDeviceId?: string;
    createdAt: number;
    updatedAt: number;
}

export interface Branch {
    branchId: string; // Format: "repoId:branchName"
    repoId: string;
    name: string;
    headCommitId: string; // SHA-256 hash of the HEAD commit
    updatedAt: number;
}

export interface TreeEntry {
    name: string;
    type: 'blob' | 'tree';
    hash: string; // SHA-256 reference to a blob or subtree
}

export interface Commit {
    commitId: string; // SHA-256 hash representing this commit
    parentCommitId?: string;
    autor: string; // ID Publico of the creator
    timestamp: number;
    mensaje: string;
    rootTree: string; // SHA-256 hash of the root Tree directory object
}

export interface DriveObject {
    hash: string; // SHA-256 of the content/metadata
    type: 'blob' | 'tree' | 'commit';
    content: string; // Serialized or base64 encoded data
}

export interface PRComment {
    commentId: string;
    author: string;
    text: string;
    timestamp: number;
}

export interface PullRequest {
    prId: string;
    repoId: string;
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    status: 'open' | 'merged' | 'closed';
    author: string;
    createdAt: number;
    mergedAt?: number;
    closedAt?: number;
    comments?: PRComment[];
}

