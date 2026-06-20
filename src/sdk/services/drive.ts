import { DB } from './db.ts';
import { BitChatAuth } from './auth.ts';
import { Repository, Branch, Commit, DriveObject, TreeEntry } from '../models/drive.ts';
import { IDriveService } from './interfaces/IDriveService.ts';

// Helper function to calculate standard SHA-256 hash of a string
async function sha256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

interface TempDir {
    files: Record<string, string>; // filename -> blobHash
    dirs: Record<string, TempDir>; // dirname -> TempDir
}

export const DriveService: IDriveService = {
    async createRepository(name: string): Promise<Repository> {
        const repoId = crypto.randomUUID();
        const now = Date.now();

        // 1. Create initial empty tree
        const initialTreeEntries: TreeEntry[] = [];
        const treeContent = JSON.stringify(initialTreeEntries);
        const treeHash = await sha256(treeContent);
        
        await DB.saveDriveObject({
            hash: treeHash,
            type: 'tree',
            content: treeContent
        });

        // 2. Create initial commit pointing to empty tree
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const autor = misCreds?.idPublico || 'local-owner';
        
        const commitData = {
            parentCommitId: undefined,
            autor,
            timestamp: now,
            mensaje: 'Initial commit',
            rootTree: treeHash
        };
        const commitId = await sha256(JSON.stringify(commitData));
        const initialCommit: Commit = {
            commitId,
            ...commitData
        };

        await DB.saveDriveObject({
            hash: commitId,
            type: 'commit',
            content: JSON.stringify(initialCommit)
        });

        // 3. Create main branch pointing to initial commit
        const branch: Branch = {
            branchId: `${repoId}:main`,
            repoId,
            name: 'main',
            headCommitId: commitId,
            updatedAt: now
        };
        await DB.saveBranch(branch);

        // 4. Create repository record
        const repo: Repository = {
            repoId,
            name,
            createdAt: now,
            updatedAt: now
        };
        await DB.saveRepository(repo);

        return repo;
    },

    async getRepository(repoId: string): Promise<Repository | null> {
        return await DB.getRepository(repoId);
    },

    async listRepositories(): Promise<Repository[]> {
        return await DB.getRepositories();
    },

    async createBranch(repoId: string, branchName: string, startCommitId?: string): Promise<Branch> {
        const repo = await DB.getRepository(repoId);
        if (!repo) throw new Error(`Repository ${repoId} not found.`);

        let commitId = startCommitId;
        if (!commitId) {
            // Find main branch to get starting commit
            const mainBranch = await DB.getBranch(repoId, 'main');
            if (!mainBranch) throw new Error("Default branch 'main' not found.");
            commitId = mainBranch.headCommitId;
        }

        // Verify commit exists
        const commitObj = await DB.getDriveObject(commitId);
        if (!commitObj || commitObj.type !== 'commit') {
            throw new Error(`Start commit ${commitId} not found or invalid.`);
        }

        const branch: Branch = {
            branchId: `${repoId}:${branchName}`,
            repoId,
            name: branchName,
            headCommitId: commitId,
            updatedAt: Date.now()
        };
        await DB.saveBranch(branch);
        return branch;
    },

    async listBranches(repoId: string): Promise<Branch[]> {
        return await DB.getBranches(repoId);
    },

    async createCommit(repoId: string, branchName: string, mensaje: string, files: { path: string, content: string }[]): Promise<Commit> {
        const branch = await DB.getBranch(repoId, branchName);
        if (!branch) throw new Error(`Branch ${branchName} not found in repository ${repoId}.`);

        // 1. Build directory tree hierarchy
        const rootDir: TempDir = { files: {}, dirs: {} };
        for (const file of files) {
            const parts = file.path.replace(/^\/+|\/+$/g, '').split('/');
            let current = rootDir;
            
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current.dirs[part]) {
                    current.dirs[part] = { files: {}, dirs: {} };
                }
                current = current.dirs[part];
            }
            
            const filename = parts[parts.length - 1];
            const blobHash = await sha256(file.content);
            
            // Save blob object
            await DB.saveDriveObject({
                hash: blobHash,
                type: 'blob',
                content: file.content
            });
            
            current.files[filename] = blobHash;
        }

        // Helper to recursively write trees to database and return their hashes
        const writeTreeObjects = async (dir: TempDir): Promise<string> => {
            const entries: TreeEntry[] = [];
            
            for (const filename in dir.files) {
                entries.push({
                    name: filename,
                    type: 'blob',
                    hash: dir.files[filename]
                });
            }
            
            for (const dirname in dir.dirs) {
                const subTreeHash = await writeTreeObjects(dir.dirs[dirname]);
                entries.push({
                    name: dirname,
                    type: 'tree',
                    hash: subTreeHash
                });
            }
            
            entries.sort((a, b) => a.name.localeCompare(b.name));
            const content = JSON.stringify(entries);
            const hash = await sha256(content);
            
            await DB.saveDriveObject({
                hash,
                type: 'tree',
                content
            });
            
            return hash;
        };

        const rootTreeHash = await writeTreeObjects(rootDir);
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const autor = misCreds?.idPublico || 'local-owner';
        const now = Date.now();

        // 2. Create the commit metadata object
        const commitData = {
            parentCommitId: branch.headCommitId,
            autor,
            timestamp: now,
            mensaje,
            rootTree: rootTreeHash
        };
        const commitId = await sha256(JSON.stringify(commitData));
        const commit: Commit = {
            commitId,
            ...commitData
        };

        await DB.saveDriveObject({
            hash: commitId,
            type: 'commit',
            content: JSON.stringify(commit)
        });

        // 3. Move branch HEAD pointer
        branch.headCommitId = commitId;
        branch.updatedAt = now;
        await DB.saveBranch(branch);

        // Update repository updatedAt
        const repo = await DB.getRepository(repoId);
        if (repo) {
            repo.updatedAt = now;
            await DB.saveRepository(repo);
        }

        return commit;
    },

    async getCommit(repoId: string, commitId: string): Promise<Commit | null> {
        const obj = await DB.getDriveObject(commitId);
        if (!obj || obj.type !== 'commit') return null;
        return JSON.parse(obj.content) as Commit;
    },

    async checkoutBranch(repoId: string, branchName: string): Promise<{ path: string, content: string }[]> {
        const branch = await DB.getBranch(repoId, branchName);
        if (!branch) throw new Error(`Branch ${branchName} not found in repository ${repoId}.`);

        const commitObj = await DB.getDriveObject(branch.headCommitId);
        if (!commitObj || commitObj.type !== 'commit') {
            throw new Error(`HEAD commit ${branch.headCommitId} not found.`);
        }
        
        const commit = JSON.parse(commitObj.content) as Commit;
        const files: { path: string, content: string }[] = [];

        // Helper to recursively traverse trees and gather files
        const traverseTree = async (treeHash: string, currentPath: string): Promise<void> => {
            const treeObj = await DB.getDriveObject(treeHash);
            if (!treeObj || treeObj.type !== 'tree') return;
            
            const entries = JSON.parse(treeObj.content) as TreeEntry[];
            for (const entry of entries) {
                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                
                if (entry.type === 'blob') {
                    const blobObj = await DB.getDriveObject(entry.hash);
                    if (blobObj) {
                        files.push({
                            path: entryPath,
                            content: blobObj.content
                        });
                    }
                } else if (entry.type === 'tree') {
                    await traverseTree(entry.hash, entryPath);
                }
            }
        };

        await traverseTree(commit.rootTree, '');
        return files;
    }
};
