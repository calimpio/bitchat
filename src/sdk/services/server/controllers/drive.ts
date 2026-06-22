import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';
import { Repository, Branch, Commit, DriveObject, TreeEntry } from '../../../models/drive.ts';

// Helper to gather objects for a repo
async function gatherRepoObjects(repoId: string): Promise<DriveObject[]> {
    const branches = await DB.getBranches(repoId);
    const objects: DriveObject[] = [];
    const visited = new Set<string>();

    const addObj = async (hash: string) => {
        if (visited.has(hash)) return;
        visited.add(hash);
        const obj = await DB.getDriveObject(hash);
        if (obj) {
            objects.push(obj);
            if (obj.type === 'commit') {
                const commit = JSON.parse(obj.content) as Commit;
                if (commit.rootTree) await addObj(commit.rootTree);
            } else if (obj.type === 'tree') {
                const entries = JSON.parse(obj.content) as TreeEntry[];
                for (const entry of entries) {
                    await addObj(entry.hash);
                }
            }
        }
    };

    for (const b of branches) {
        let curr = b.headCommitId;
        while (curr) {
            await addObj(curr);
            const commitObj = await DB.getDriveObject(curr);
            if (commitObj && commitObj.type === 'commit') {
                const commit = JSON.parse(commitObj.content) as Commit;
                curr = commit.parentCommitId || '';
            } else {
                break;
            }
        }
    }
    return objects;
}

export const driveRPCController = {
    async handleListRepos(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando DRIVE_LIST_REPOS_REQ de ${ctx.conn.peer}`);
        const repos = await DB.getRepositories();
        await ctx.response({ repos }, 'DRIVE_LIST_REPOS_RESP');
    },

    async handleClone(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando DRIVE_CLONE_REQ de ${ctx.conn.peer}`);
        const { repoId } = ctx.paquete as any;
        if (!repoId) throw new Error("repoId es requerido.");

        const repo = await DB.getRepository(repoId);
        if (!repo) throw new Error(`Repositorio ${repoId} no encontrado.`);

        const branches = await DB.getBranches(repoId);
        const pullRequests = await DB.getPullRequests(repoId);
        const objects = await gatherRepoObjects(repoId);

        await ctx.response({
            repo,
            branches,
            objects,
            pullRequests
        }, 'DRIVE_CLONE_RESP');
    },

    async handlePull(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando DRIVE_PULL_REQ de ${ctx.conn.peer}`);
        const { repoId } = ctx.paquete as any;
        if (!repoId) throw new Error("repoId es requerido.");

        const repo = await DB.getRepository(repoId);
        if (!repo) throw new Error(`Repositorio ${repoId} no encontrado.`);

        const branches = await DB.getBranches(repoId);
        const pullRequests = await DB.getPullRequests(repoId);
        const objects = await gatherRepoObjects(repoId);

        await ctx.response({
            branches,
            objects,
            pullRequests
        }, 'DRIVE_PULL_RESP');
    },

    async handlePush(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando DRIVE_PUSH_REQ de ${ctx.conn.peer}`);
        const { repoId, branches, objects, pullRequests } = ctx.paquete as any;
        if (!repoId) throw new Error("repoId es requerido.");

        // Save objects
        if (objects && Array.isArray(objects)) {
            for (const obj of objects) {
                await DB.saveDriveObject(obj);
            }
        }

        // Save branches
        if (branches && Array.isArray(branches)) {
            for (const b of branches) {
                await DB.saveBranch(b);
            }
        }

        // Save pull requests
        if (pullRequests && Array.isArray(pullRequests)) {
            for (const pr of pullRequests) {
                await DB.savePullRequest(pr);
            }
        }

        // Update repository record
        const repo = await DB.getRepository(repoId);
        if (repo) {
            repo.updatedAt = Date.now();
            await DB.saveRepository(repo);
        }

        await ctx.response({ success: true }, 'DRIVE_PUSH_RESP');
    }
};
