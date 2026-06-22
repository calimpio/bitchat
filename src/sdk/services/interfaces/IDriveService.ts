import { Repository, Branch, Commit, PullRequest, PRComment } from '../../models/drive.ts';

export interface IDriveService {
    /** Creates a new Git-like repository and an initial empty commit on the default branch ('main'). */
    createRepository(name: string): Promise<Repository>;

    /** Retrieves repository metadata by its ID. */
    getRepository(repoId: string): Promise<Repository | null>;

    /** Lists all locally registered repositories. */
    listRepositories(): Promise<Repository[]>;

    /** Creates a new branch pointing to an optional start commit or the current branch HEAD. */
    createBranch(repoId: string, branchName: string, startCommitId?: string): Promise<Branch>;

    /** Lists all branches of a specific repository. */
    listBranches(repoId: string): Promise<Branch[]>;

    /** Creates a commit on a branch containing the specified files and folder structure. */
    createCommit(repoId: string, branchName: string, mensaje: string, files: { path: string, content: string }[]): Promise<Commit>;

    /** Retrieves a specific commit metadata by its SHA-256 hash. */
    getCommit(repoId: string, commitId: string): Promise<Commit | null>;

    /** Recovers the files and their content at the HEAD of the given branch. */
    checkoutBranch(repoId: string, branchName: string): Promise<{ path: string, content: string }[]>;

    /** Deletes a repository and all its branches. */
    deleteRepository(repoId: string): Promise<void>;

    /** Renames a repository. */
    renameRepository(repoId: string, newName: string): Promise<void>;

    /** Lists all pull requests for a specific repository. */
    listPullRequests(repoId: string): Promise<PullRequest[]>;

    /** Creates a new pull request. */
    createPullRequest(repoId: string, title: string, description: string, sourceBranch: string, targetBranch: string): Promise<PullRequest>;

    /** Retrieves a specific pull request. */
    getPullRequest(repoId: string, prId: string): Promise<PullRequest | null>;

    /** Merges a pull request by combining files and creating a merge commit. */
    mergePullRequest(repoId: string, prId: string): Promise<Commit>;

    /** Closes a pull request without merging. */
    closePullRequest(repoId: string, prId: string): Promise<void>;

    /** Adds a comment to an open pull request. */
    addPullRequestComment(repoId: string, prId: string, text: string): Promise<PRComment>;
}
