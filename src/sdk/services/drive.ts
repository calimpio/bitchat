import { DB } from './db.ts';
import { BitChatAuth } from './auth.ts';
import { Repository, Branch, Commit, DriveObject, TreeEntry, PullRequest, PRComment } from '../models/drive.ts';
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
        const localDeviceId = localStorage.getItem('bit_device_id') || 'local';
        const repo: Repository = {
            repoId,
            name,
            originDeviceId: localDeviceId,
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
    },

    async deleteRepository(repoId: string): Promise<void> {
        await DB.deleteRepository(repoId);
    },

    async renameRepository(repoId: string, newName: string): Promise<void> {
        const repo = await DB.getRepository(repoId);
        if (!repo) throw new Error(`Repository ${repoId} not found.`);
        repo.name = newName;
        repo.updatedAt = Date.now();
        await DB.saveRepository(repo);
    },

    async listPullRequests(repoId: string): Promise<PullRequest[]> {
        return await DB.getPullRequests(repoId);
    },

    async createPullRequest(repoId: string, title: string, description: string, sourceBranch: string, targetBranch: string): Promise<PullRequest> {
        const repo = await DB.getRepository(repoId);
        if (!repo) throw new Error(`Repository ${repoId} not found.`);
        if (sourceBranch === targetBranch) throw new Error("Las ramas de origen y destino no pueden ser iguales.");

        const source = await DB.getBranch(repoId, sourceBranch);
        if (!source) throw new Error(`Rama de origen ${sourceBranch} no encontrada.`);

        const target = await DB.getBranch(repoId, targetBranch);
        if (!target) throw new Error(`Rama de destino ${targetBranch} no encontrada.`);

        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const author = misCreds?.idPublico || 'local-owner';
        const now = Date.now();

        const pr: PullRequest = {
            prId: crypto.randomUUID(),
            repoId,
            title,
            description,
            sourceBranch,
            targetBranch,
            status: 'open',
            author,
            createdAt: now
        };

        await DB.savePullRequest(pr);
        return pr;
    },

    async getPullRequest(repoId: string, prId: string): Promise<PullRequest | null> {
        return await DB.getPullRequest(repoId, prId);
    },

    async mergePullRequest(repoId: string, prId: string): Promise<Commit> {
        const pr = await DB.getPullRequest(repoId, prId);
        if (!pr) throw new Error(`Pull request ${prId} no encontrado.`);
        if (pr.status !== 'open') throw new Error(`El pull request no está abierto (estado actual: ${pr.status}).`);

        const sourceFiles = await this.checkoutBranch(repoId, pr.sourceBranch);
        const targetFiles = await this.checkoutBranch(repoId, pr.targetBranch);

        const mergedFilesMap = new Map<string, string>();
        for (const f of targetFiles) {
            mergedFilesMap.set(f.path, f.content);
        }
        for (const f of sourceFiles) {
            mergedFilesMap.set(f.path, f.content);
        }

        const mergedFiles = Array.from(mergedFilesMap.entries()).map(([path, content]) => ({ path, content }));
        const commitMsg = `Merge pull request #${pr.prId.substring(0, 4)}: ${pr.title}`;
        
        const commit = await this.createCommit(repoId, pr.targetBranch, commitMsg, mergedFiles);

        // Update PR state
        pr.status = 'merged';
        pr.mergedAt = Date.now();
        await DB.savePullRequest(pr);

        return commit;
    },

    async closePullRequest(repoId: string, prId: string): Promise<void> {
        const pr = await DB.getPullRequest(repoId, prId);
        if (!pr) throw new Error(`Pull request ${prId} no encontrado.`);
        if (pr.status !== 'open') throw new Error(`El pull request no está abierto.`);

        pr.status = 'closed';
        pr.closedAt = Date.now();
        await DB.savePullRequest(pr);
    },

    async addPullRequestComment(repoId: string, prId: string, text: string): Promise<PRComment> {
        const pr = await DB.getPullRequest(repoId, prId);
        if (!pr) throw new Error(`Pull request ${prId} no encontrado.`);
        if (pr.status !== 'open') throw new Error("No se puede comentar en un Pull Request cerrado o fusionado.");

        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const author = misCreds?.idPublico || 'local-owner';
        const now = Date.now();

        const comment: PRComment = {
            commentId: crypto.randomUUID(),
            author,
            text: text.trim(),
            timestamp: now
        };

        if (!pr.comments) {
            pr.comments = [];
        }
        pr.comments.push(comment);

        await DB.savePullRequest(pr);
        return comment;
    }
};
