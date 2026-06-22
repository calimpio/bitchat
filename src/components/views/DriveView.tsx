import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { DriveService, DB, PeerService } from '../../sdk/index.ts';
import { Repository, Branch, Commit, TreeEntry, PullRequest, PRComment, DriveObject } from '../../sdk/models/drive.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

export const DriveView: React.FC = () => {
    const { me, devices } = useStore();
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [activeRepo, setActiveRepo] = useState<Repository | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [activeBranch, setActiveBranch] = useState<string>('main');
    const [commits, setCommits] = useState<Commit[]>([]);
    
    // File state
    const [committedFiles, setCommittedFiles] = useState<{ path: string; content: string }[]>([]);
    const [workingFiles, setWorkingFiles] = useState<{ path: string; content: string }[]>([]);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    
    // Editor State
    const [editorPath, setEditorPath] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [isCreatingNewFile, setIsCreatingNewFile] = useState(false);
    
    // Commit Message State
    const [commitMessage, setCommitMessage] = useState('');
    const [activeTab, setActiveTab] = useState<'editor' | 'history' | 'settings' | 'pullrequests'>('editor');

    // Pull Requests State
    const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
    const [activePR, setActivePR] = useState<PullRequest | null>(null);
    const [showCreatePRModal, setShowCreatePRModal] = useState(false);
    const [newPRTitle, setNewPRTitle] = useState('');
    const [newPRDescription, setNewPRDescription] = useState('');
    const [newPRSource, setNewPRSource] = useState('');
    const [newPRTarget, setNewPRTarget] = useState('main');
    const [prDiffFiles, setPrDiffFiles] = useState<{ path: string; status: 'added' | 'modified' | 'deleted'; sourceContent?: string; targetContent?: string }[]>([]);
    const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
    const [prCommentText, setPrCommentText] = useState('');

    // Cloning & Remote search state
    const [remoteRepos, setRemoteRepos] = useState<{ repo: Repository; deviceId: string; deviceLabel: string }[]>([]);
    const [isSearchingRemotes, setIsSearchingRemotes] = useState(false);
    const [driveHomeTab, setDriveHomeTab] = useState<'local' | 'devices'>('local');

    // Modals
    const [showCreateRepo, setShowCreateRepo] = useState(false);
    const [newRepoName, setNewRepoName] = useState('');
    const [showCreateBranch, setShowCreateBranch] = useState(false);
    const [newBranchName, setNewBranchName] = useState('');

    // Rename state
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [fileToRename, setFileToRename] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    // Repository settings/rename state
    const [repoRenameValue, setRepoRenameValue] = useState('');

    // Custom popup state (replacing native alert/confirm/prompt)
    const [popup, setPopup] = useState<{
        type: 'alert' | 'confirm' | 'prompt';
        title: string;
        message: string;
        placeholder?: string;
        onConfirm?: (value?: string) => void;
        onCancel?: () => void;
    } | null>(null);
    const [popupPromptValue, setPopupPromptValue] = useState('');

    const showAlert = (title: string, message: string, onConfirm?: () => void) => {
        setPopup({
            type: 'alert',
            title,
            message,
            onConfirm: () => {
                setPopup(null);
                if (onConfirm) onConfirm();
            }
        });
    };

    const showConfirm = (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => {
        setPopup({
            type: 'confirm',
            title,
            message,
            onConfirm: () => {
                setPopup(null);
                onConfirm();
            },
            onCancel: () => {
                setPopup(null);
                if (onCancel) onCancel();
            }
        });
    };

    const showPrompt = (title: string, message: string, placeholder: string, onConfirm: (val: string) => void, onCancel?: () => void) => {
        setPopupPromptValue('');
        setPopup({
            type: 'prompt',
            title,
            message,
            placeholder,
            onConfirm: (val) => {
                setPopup(null);
                onConfirm(val || '');
            },
            onCancel: () => {
                setPopup(null);
                if (onCancel) onCancel();
            }
        });
    };

    const loadRepositories = async () => {
        const list = await DriveService.listRepositories();
        setRepositories(list);
    };

    useEffect(() => {
        loadRepositories();
    }, []);

    const loadRepoData = async (repo: Repository, branchName: string) => {
        try {
            const list = await DriveService.listBranches(repo.repoId);
            setBranches(list);

            const prs = await DriveService.listPullRequests(repo.repoId);
            setPullRequests(prs);

            const activeBranchObj = list.find(b => b.name === branchName) || list[0];
            const currentBranchName = activeBranchObj ? activeBranchObj.name : 'main';
            setActiveBranch(currentBranchName);

            if (activeBranchObj) {
                // Load commits history
                const commitHistory: Commit[] = [];
                let currentId: string | undefined = activeBranchObj.headCommitId;
                while (currentId) {
                    const commit = await DriveService.getCommit(repo.repoId, currentId);
                    if (commit) {
                        commitHistory.push(commit);
                        currentId = commit.parentCommitId;
                    } else {
                        break;
                    }
                }
                setCommits(commitHistory);

                // Load committed files
                const files = await DriveService.checkoutBranch(repo.repoId, currentBranchName);
                setCommittedFiles(files);
                setWorkingFiles(JSON.parse(JSON.stringify(files))); // Deep copy
            }
        } catch (e) {
            console.error("Error loading repository data", e);
        }
    };

    useEffect(() => {
        if (activeRepo) {
            loadRepoData(activeRepo, activeBranch);
            setRepoRenameValue(activeRepo.name);
        }
    }, [activeRepo, activeBranch]);

    const handleCreateRepository = async () => {
        if (!newRepoName.trim()) return showAlert("Error", "El nombre es requerido");
        try {
            const repo = await DriveService.createRepository(newRepoName.trim());
            setNewRepoName('');
            setShowCreateRepo(false);
            await loadRepositories();
            setActiveRepo(repo);
            setActiveBranch('main');
        } catch (e) {
            showAlert("Error", "Error al crear el repositorio");
        }
    };

    const handleCreateBranch = async () => {
        if (!activeRepo) return;
        if (!newBranchName.trim()) return showAlert("Error", "El nombre es requerido");
        try {
            const cleanName = newBranchName.trim().replace(/\s+/g, '-');
            await DriveService.createBranch(activeRepo.repoId, cleanName);
            setNewBranchName('');
            setShowCreateBranch(false);
            await loadRepoData(activeRepo, cleanName);
        } catch (e: any) {
            showAlert("Error", e.message || "Error al crear la rama");
        }
    };

    const handleSaveFile = () => {
        if (!editorPath.trim()) return showAlert("Error", "La ruta del archivo es requerida");
        
        const path = editorPath.trim();
        const updated = [...workingFiles];

        if (!isCreatingNewFile && selectedFilePath) {
            // Rename/update existing file
            const idx = updated.findIndex(f => f.path === selectedFilePath);
            if (idx !== -1) {
                // If they changed the name to something else that already exists, warn them
                const collisionIdx = updated.findIndex((f, i) => f.path === path && i !== idx);
                if (collisionIdx !== -1) {
                    return showAlert("Error", "Ya existe un archivo con ese nombre.");
                }
                updated[idx].path = path;
                updated[idx].content = editorContent;
            }
        } else {
            // Create new file or overwrite exact matching path
            const existingIdx = updated.findIndex(f => f.path === path);
            if (existingIdx !== -1) {
                updated[existingIdx].content = editorContent;
            } else {
                updated.push({ path, content: editorContent });
            }
        }

        setWorkingFiles(updated);
        setSelectedFilePath(path);
        setIsCreatingNewFile(false);
        showAlert("Guardado", "Archivo guardado en el directorio de trabajo.");
    };

    const handleDeleteFile = (path: string) => {
        showConfirm("Eliminar archivo", `¿Eliminar ${path} del directorio de trabajo?`, () => {
            const updated = workingFiles.filter(f => f.path !== path);
            setWorkingFiles(updated);
            if (selectedFilePath === path) {
                setSelectedFilePath(null);
                setEditorPath('');
                setEditorContent('');
            }
        });
    };

    const handleRenameFileClick = (path: string) => {
        setFileToRename(path);
        setRenameValue(path);
        setShowRenameModal(true);
    };

    const handleRenameFileSubmit = () => {
        if (!fileToRename) return;
        const newPath = renameValue.trim();
        if (!newPath) return showAlert("Error", "El nombre/ruta del archivo no puede estar vacío");
        if (newPath === fileToRename) {
            setShowRenameModal(false);
            return;
        }

        const updated = [...workingFiles];
        const collisionIdx = updated.findIndex(f => f.path === newPath);
        if (collisionIdx !== -1) {
            return showAlert("Error", "Ya existe un archivo con ese nombre.");
        }

        const idx = updated.findIndex(f => f.path === fileToRename);
        if (idx !== -1) {
            updated[idx].path = newPath;
            setWorkingFiles(updated);
            if (selectedFilePath === fileToRename) {
                setSelectedFilePath(newPath);
                setEditorPath(newPath);
            }
            setShowRenameModal(false);
            setFileToRename(null);
            setRenameValue('');
            showAlert("Éxito", "Archivo renombrado con éxito.");
        }
    };

    const handleRenameRepo = async () => {
        if (!activeRepo) return;
        const newName = repoRenameValue.trim();
        if (!newName) return showAlert("Error", "El nombre del repositorio no puede estar vacío");
        try {
            await DriveService.renameRepository(activeRepo.repoId, newName);
            setActiveRepo({ ...activeRepo, name: newName });
            await loadRepositories();
            showAlert("Éxito", "Repositorio renombrado con éxito.");
        } catch (e: any) {
            showAlert("Error", e.message || "Error al renombrar el repositorio");
        }
    };

    const handleDiscardLocalChanges = () => {
        if (!activeRepo) return;
        showConfirm("Descartar cambios", "¿Estás seguro de que deseas descartar todos los cambios locales no confirmados? Esta acción es irreversible.", () => {
            setWorkingFiles(JSON.parse(JSON.stringify(committedFiles)));
            setSelectedFilePath(null);
            setEditorPath('');
            setEditorContent('');
            showAlert("Descartado", "Se han descartado los cambios locales.");
        });
    };

    const handleDeleteRepo = async () => {
        if (!activeRepo) return;
        
        showPrompt(
            "Confirmar Eliminación", 
            `¿Estás seguro de que deseas eliminar este repositorio y todas sus ramas de forma permanente?\n\nEsta acción es irreversible.\n\nPor favor, escribe o pega el ID del repositorio para confirmar la eliminación:`,
            activeRepo.repoId,
            async (userInput) => {
                if (userInput.trim() !== activeRepo.repoId) {
                    return showAlert("Error", "El ID del repositorio no coincide. Operación cancelada.");
                }

                try {
                    await DriveService.deleteRepository(activeRepo.repoId);
                    setActiveRepo(null);
                    await loadRepositories();
                    showAlert("Éxito", "Repositorio eliminado con éxito.");
                } catch (e: any) {
                    showAlert("Error", e.message || "Error al eliminar el repositorio");
                }
            }
        );
    };

    const handleSelectFile = (path: string) => {
        const file = workingFiles.find(f => f.path === path);
        if (file) {
            setSelectedFilePath(path);
            setEditorPath(file.path);
            setEditorContent(file.content);
            setIsCreatingNewFile(false);
            setActiveTab('editor');
        }
    };

    const handleNewFile = () => {
        setSelectedFilePath(null);
        setEditorPath('');
        setEditorContent('');
        setIsCreatingNewFile(true);
        setActiveTab('editor');
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const filesList = e.target.files;
        if (!filesList) return;
        
        const newFiles = [...workingFiles];
        let loadedCount = 0;
        const total = filesList.length;

        for (let i = 0; i < total; i++) {
            const file = filesList[i];
            const reader = new FileReader();
            
            reader.onload = (event) => {
                const content = event.target?.result as string;
                const path = file.name;
                
                const existingIdx = newFiles.findIndex(f => f.path === path);
                if (existingIdx !== -1) {
                    newFiles[existingIdx].content = content;
                } else {
                    newFiles.push({ path, content });
                }
                
                loadedCount++;
                if (loadedCount === total) {
                    setWorkingFiles(newFiles);
                    // Automatically select the last loaded file
                    const lastFile = newFiles[newFiles.length - 1];
                    setSelectedFilePath(lastFile.path);
                    setEditorPath(lastFile.path);
                    setEditorContent(lastFile.content);
                    setIsCreatingNewFile(false);
                    setActiveTab('editor');
                    showAlert("Subida exitosa", `${total} archivo(s) subido(s) al directorio de trabajo.`);
                }
            };

            const isBinary = file.type && !file.type.startsWith('text/') && 
                             !file.name.endsWith('.js') && 
                             !file.name.endsWith('.ts') && 
                             !file.name.endsWith('.jsx') && 
                             !file.name.endsWith('.tsx') && 
                             !file.name.endsWith('.json') && 
                             !file.name.endsWith('.md') && 
                             !file.name.endsWith('.css') && 
                             !file.name.endsWith('.html');
                             
            if (isBinary) {
                reader.readAsDataURL(file);
            } else {
                reader.readAsText(file);
            }
        }
    };

    const handleCommit = async () => {
        if (!activeRepo) return;
        if (!commitMessage.trim()) return showAlert("Error", "El mensaje del commit es requerido");

        const executeCommit = async () => {
            try {
                await DriveService.createCommit(activeRepo.repoId, activeBranch, commitMessage.trim(), workingFiles);
                setCommitMessage('');
                showAlert("Éxito", "Commit creado con éxito.");
                await loadRepoData(activeRepo, activeBranch);
            } catch (e: any) {
                showAlert("Error", e.message || "Error al procesar el commit");
            }
        };

        if (workingFiles.length === 0) {
            showConfirm("Commit Vacío", "El commit estará vacío. ¿Continuar?", executeCommit);
        } else {
            await executeCommit();
        }
    };

    const loadPRDiffs = async (pr: PullRequest) => {
        if (!activeRepo) return;
        try {
            const sourceFiles = await DriveService.checkoutBranch(activeRepo.repoId, pr.sourceBranch);
            const targetFiles = await DriveService.checkoutBranch(activeRepo.repoId, pr.targetBranch);
            
            const diffs: typeof prDiffFiles = [];
            
            for (const sf of sourceFiles) {
                const tf = targetFiles.find(f => f.path === sf.path);
                if (!tf) {
                    diffs.push({ path: sf.path, status: 'added', sourceContent: sf.content });
                } else if (tf.content !== sf.content) {
                    diffs.push({ path: sf.path, status: 'modified', sourceContent: sf.content, targetContent: tf.content });
                }
            }
            
            for (const tf of targetFiles) {
                const sf = sourceFiles.find(f => f.path === tf.path);
                if (!sf) {
                    diffs.push({ path: tf.path, status: 'deleted', targetContent: tf.content });
                }
            }
            
            setPrDiffFiles(diffs);
            setSelectedDiffFile(null);
        } catch (e) {
            console.error("Error loading PR diffs", e);
        }
    };

    const handleCreatePR = async () => {
        if (!activeRepo) return;
        if (!newPRTitle.trim()) return showAlert("Error", "El título es requerido");
        if (!newPRSource || !newPRTarget) return showAlert("Error", "Debes seleccionar las ramas de origen y destino.");
        if (newPRSource === newPRTarget) return showAlert("Error", "Las ramas de origen y destino no pueden ser iguales.");
        try {
            const pr = await DriveService.createPullRequest(
                activeRepo.repoId,
                newPRTitle.trim(),
                newPRDescription.trim(),
                newPRSource,
                newPRTarget
            );
            setNewPRTitle('');
            setNewPRDescription('');
            setShowCreatePRModal(false);
            showAlert("Éxito", "Pull Request creado con éxito.");
            await loadRepoData(activeRepo, activeBranch);
            setActivePR(pr);
            await loadPRDiffs(pr);
        } catch (e: any) {
            showAlert("Error", e.message || "Error al crear el pull request");
        }
    };

    const handleMergePR = async (pr: PullRequest) => {
        if (!activeRepo) return;
        showConfirm(
            "Fusionar Pull Request", 
            `¿Fusionar la rama '${pr.sourceBranch}' en '${pr.targetBranch}'? Esto aplicará todos los cambios y creará un nuevo commit de fusión en '${pr.targetBranch}'.`,
            async () => {
                try {
                    await DriveService.mergePullRequest(activeRepo.repoId, pr.prId);
                    showAlert("Éxito", "Pull Request fusionado con éxito.");
                    await loadRepoData(activeRepo, activeBranch);
                    const updatedPR = await DriveService.getPullRequest(activeRepo.repoId, pr.prId);
                    setActivePR(updatedPR);
                    if (updatedPR) {
                        await loadPRDiffs(updatedPR);
                    }
                } catch (e: any) {
                    showAlert("Error", e.message || "Error al fusionar el pull request");
                }
            }
        );
    };

    const handleClosePR = async (pr: PullRequest) => {
        if (!activeRepo) return;
        showConfirm(
            "Cerrar Pull Request", 
            `¿Estás seguro de que deseas cerrar este Pull Request sin fusionar los cambios?`,
            async () => {
                try {
                    await DriveService.closePullRequest(activeRepo.repoId, pr.prId);
                    showAlert("Cerrado", "Pull Request cerrado con éxito.");
                    await loadRepoData(activeRepo, activeBranch);
                    const updatedPR = await DriveService.getPullRequest(activeRepo.repoId, pr.prId);
                    setActivePR(updatedPR);
                } catch (e: any) {
                    showAlert("Error", e.message || "Error al cerrar el pull request");
                }
            }
        );
    };

    const handleAddPRComment = async () => {
        if (!activeRepo || !activePR) return;
        if (!prCommentText.trim()) return;

        try {
            await DriveService.addPullRequestComment(activeRepo.repoId, activePR.prId, prCommentText.trim());
            setPrCommentText('');
            const updatedPR = await DriveService.getPullRequest(activeRepo.repoId, activePR.prId);
            setActivePR(updatedPR);
            await loadRepoData(activeRepo, activeBranch);
        } catch (e: any) {
            showAlert("Error", e.message || "Error al agregar comentario");
        }
    };

    const handleSearchRemoteRepos = async () => {
        setIsSearchingRemotes(true);
        setRemoteRepos([]);

        const found: typeof remoteRepos = [];
        const onlineDevices = devices.filter(d => d.isOnline && d.label !== 'Este Dispositivo (Principal)');

        for (const device of onlineDevices) {
            try {
                const conn = PeerService.deviceConns && PeerService.deviceConns[device.deviceId];
                if (conn && conn.open) {
                    const response = await PeerService.request<{ repos: Repository[] }>(conn, 'DRIVE_LIST_REPOS_REQ', {});
                    if (response && response.repos) {
                        for (const r of response.repos) {
                            const exists = repositories.some(local => local.repoId === r.repoId);
                            if (!exists) {
                                found.push({
                                    repo: r,
                                    deviceId: device.deviceId,
                                    deviceLabel: device.label
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Error listando repos del dispositivo ${device.deviceId}`, err);
            }
        }

        setRemoteRepos(found);
        setIsSearchingRemotes(false);
    };

    const handleCloneRemoteRepo = async (remoteRepoId: string, deviceId: string) => {
        const conn = PeerService.deviceConns && PeerService.deviceConns[deviceId];
        if (!conn || !conn.open) {
            return showAlert("Error", "El dispositivo no está conectado.");
        }

        try {
            const data = await PeerService.request<{
                repo: Repository;
                branches: Branch[];
                objects: DriveObject[];
                pullRequests?: PullRequest[];
            }>(conn, 'DRIVE_CLONE_REQ', { repoId: remoteRepoId });

            if (!data || !data.repo) {
                throw new Error("Respuesta inválida del dispositivo.");
            }

            for (const obj of data.objects) {
                await DB.saveDriveObject(obj);
            }

            for (const b of data.branches) {
                await DB.saveBranch(b);
            }

            if (data.pullRequests) {
                for (const pr of data.pullRequests) {
                    await DB.savePullRequest(pr);
                }
            }

            const clonedRepo: Repository = {
                ...data.repo,
                originDeviceId: deviceId
            };
            await DB.saveRepository(clonedRepo);

            showAlert("Éxito", `Repositorio '${clonedRepo.name}' clonado con éxito.`);
            await loadRepositories();
        } catch (e: any) {
            showAlert("Error", e.message || "Error al clonar el repositorio.");
        }
    };

    const handlePullRemoteRepo = async () => {
        if (!activeRepo || !activeRepo.originDeviceId) return;

        const conn = PeerService.deviceConns && PeerService.deviceConns[activeRepo.originDeviceId];
        if (!conn || !conn.open) {
            return showAlert("Error", "El dispositivo origen no está en línea o conectado.");
        }

        showConfirm(
            "Actualizar Repositorio (Pull)",
            `¿Descargar y aplicar los últimos cambios desde el dispositivo de origen?`,
            async () => {
                try {
                    const data = await PeerService.request<{
                        branches: Branch[];
                        objects: DriveObject[];
                        pullRequests?: PullRequest[];
                    }>(conn, 'DRIVE_PULL_REQ', { repoId: activeRepo.repoId });

                    for (const obj of data.objects) {
                        await DB.saveDriveObject(obj);
                    }

                    for (const b of data.branches) {
                        await DB.saveBranch(b);
                    }

                    if (data.pullRequests) {
                        for (const pr of data.pullRequests) {
                            await DB.savePullRequest(pr);
                        }
                    }

                    showAlert("Éxito", "Repositorio actualizado con éxito (Pull).");
                    await loadRepoData(activeRepo, activeBranch);
                } catch (e: any) {
                    showAlert("Error", e.message || "Error al actualizar el repositorio.");
                }
            }
        );
    };

    const handlePushRemoteRepo = async () => {
        if (!activeRepo || !activeRepo.originDeviceId) return;

        const conn = PeerService.deviceConns && PeerService.deviceConns[activeRepo.originDeviceId];
        if (!conn || !conn.open) {
            return showAlert("Error", "El dispositivo origen no está en línea o conectado.");
        }

        showConfirm(
            "Enviar Cambios (Push)",
            `¿Enviar tus commits y ramas locales al dispositivo de origen?`,
            async () => {
                try {
                    const branchesList = await DB.getBranches(activeRepo.repoId);
                    const pullRequestsList = await DB.getPullRequests(activeRepo.repoId);
                    
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

                    for (const b of branchesList) {
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

                    const response = await PeerService.request<{ success: boolean }>(conn, 'DRIVE_PUSH_REQ', {
                        repoId: activeRepo.repoId,
                        branches: branchesList,
                        objects,
                        pullRequests: pullRequestsList
                    });

                    if (response && response.success) {
                        showAlert("Éxito", "Cambios enviados con éxito (Push).");
                    } else {
                        throw new Error("El dispositivo origen rechazó los cambios.");
                    }
                } catch (e: any) {
                    showAlert("Error", e.message || "Error al enviar los cambios.");
                }
            }
        );
    };

    // Calculate diffs between committed files and workingFiles
    const getModifiedStatus = (path: string) => {
        const committed = committedFiles.find(f => f.path === path);
        const working = workingFiles.find(f => f.path === path);
        
        if (!committed && working) return 'added';
        if (committed && !working) return 'deleted';
        if (committed && working && committed.content !== working.content) return 'modified';
        return 'unmodified';
    };

    const getChangesList = () => {
        const changes: { path: string; status: 'added' | 'modified' | 'deleted' }[] = [];
        
        // Check for added/modified
        for (const wf of workingFiles) {
            const status = getModifiedStatus(wf.path);
            if (status !== 'unmodified') {
                changes.push({ path: wf.path, status: status as any });
            }
        }

        // Check for deleted
        for (const cf of committedFiles) {
            if (!workingFiles.some(wf => wf.path === cf.path)) {
                changes.push({ path: cf.path, status: 'deleted' });
            }
        }

        return changes;
    };

    const changes = getChangesList();
    const isDirty = changes.length > 0;

    if (!activeRepo) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '900px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ color: 'var(--primary)', margin: 0 }}>📂 bitDrive</h2>
                </div>

                <p style={{ color: 'var(--text-dim)', fontSize: '14px', textAlign: 'center', margin: '0 0 10px 0' }}>
                    Versionador de archivos descentralizado tipo Git. Crea o clona un repositorio para empezar a versionar tus carpetas.
                </p>

                {/* Sub-tab selection bar */}
                <div style={{ display: 'flex', gap: '15px', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '5px' }}>
                    <span 
                        onClick={() => setDriveHomeTab('local')}
                        style={{ fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', color: driveHomeTab === 'local' ? 'var(--accent-blue)' : 'var(--text-dim)', borderBottom: driveHomeTab === 'local' ? '2px solid var(--accent-blue)' : '2px solid transparent', paddingBottom: '6px' }}
                    >
                        🏠 En mi local
                    </span>
                    <span 
                        onClick={() => {
                            setDriveHomeTab('devices');
                            handleSearchRemoteRepos();
                        }}
                        style={{ fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', color: driveHomeTab === 'devices' ? 'var(--accent-blue)' : 'var(--text-dim)', borderBottom: driveHomeTab === 'devices' ? '2px solid var(--accent-blue)' : '2px solid transparent', paddingBottom: '6px' }}
                    >
                        📱 En mis dispositivos
                    </span>
                </div>

                {driveHomeTab === 'local' && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>Repositorios Locales</span>
                            <Button variant="primary" onClick={() => setShowCreateRepo(true)}>📁 Nuevo Repositorio</Button>
                        </div>
                        
                        <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '2px 0 15px 0' }}>
                            Repositorios locales almacenados en este dispositivo (creados aquí o clonados de otros).
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
                            {repositories.map(repo => {
                                const isRemote = repo.originDeviceId && repo.originDeviceId !== (localStorage.getItem('bit_device_id') || 'local');
                                return (
                                    <Card key={repo.repoId} style={{ padding: '20px', cursor: 'pointer', border: isRemote ? '1px dashed var(--accent-blue)' : '1px solid var(--border)' }} onClick={() => { setActiveRepo(repo); setActiveBranch('main'); }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <h4 style={{ color: 'var(--accent-blue)', fontSize: '16px', margin: '0 0 8px 0' }}>🏛️ {repo.name}</h4>
                                            {isRemote && (
                                                <span style={{ fontSize: '9px', fontWeight: 'bold', background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)', padding: '2px 6px', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.3)' }}>
                                                    CLONADO
                                                </span>
                                            )}
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--text-dim)', wordBreak: 'break-all', margin: '0 0 15px 0' }}>ID: {repo.repoId}</p>
                                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                                            <span>Creado: {new Date(repo.createdAt).toLocaleDateString()}</span>
                                            <span>Activo</span>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>

                        {repositories.length === 0 && (
                            <Card style={{ padding: '40px', borderStyle: 'dashed', background: 'transparent', textAlign: 'center', marginTop: '10px' }}>
                                <p style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                                    No se han encontrado repositorios locales.
                                </p>
                                <Button variant="ghost" style={{ margin: '0 auto' }} onClick={() => setShowCreateRepo(true)}>Inicializar Primer Repositorio</Button>
                            </Card>
                        )}
                    </>
                )}

                {driveHomeTab === 'devices' && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>Repositorios en la red P2P</span>
                            <Button variant="ghost" onClick={handleSearchRemoteRepos} disabled={isSearchingRemotes}>
                                {isSearchingRemotes ? 'Buscando...' : '🔍 Buscar Repositorios'}
                            </Button>
                        </div>
                        
                        <p style={{ color: 'var(--text-dim)', fontSize: '12px', margin: '2px 0 15px 0' }}>
                            Busca repositorios en tus otros dispositivos conectados en línea para clonarlos localmente (los transmite a tu base de datos IndexedDB).
                        </p>

                        {isSearchingRemotes ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '12px' }}>
                                <span style={{ fontSize: '32px' }}>🔄</span>
                                <span style={{ fontSize: '14px', color: 'var(--text-dim)' }}>Consultando dispositivos conectados en línea...</span>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                {remoteRepos.map(item => (
                                    <Card key={item.repo.repoId} style={{ padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '15px' }}>
                                        <div>
                                            <h4 style={{ color: 'var(--text-main)', fontSize: '16px', margin: '0 0 8px 0' }}>🏛️ {item.repo.name}</h4>
                                            <span style={{ fontSize: '11px', color: 'var(--accent-blue)', display: 'block', marginBottom: '4px' }}>
                                                Dispositivo: <strong>{item.deviceLabel}</strong>
                                            </span>
                                            <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                                                ID: {item.repo.repoId}
                                            </span>
                                        </div>
                                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                                Modificado: {new Date(item.repo.updatedAt).toLocaleDateString()}
                                            </span>
                                            <Button 
                                                variant="success" 
                                                className="btn-sm" 
                                                onClick={async () => {
                                                    await handleCloneRemoteRepo(item.repo.repoId, item.deviceId);
                                                    setDriveHomeTab('local');
                                                }}
                                            >
                                                📥 Clonar
                                            </Button>
                                        </div>
                                    </Card>
                                ))}

                                {remoteRepos.length === 0 && (
                                    <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '10px', color: 'var(--text-dim)' }}>
                                        No se encontraron repositorios clonables en línea. Asegúrate de tener otras terminales enlazadas y activas.
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                <Modal active={showCreateRepo} title="Crear Repositorio" onClose={() => setShowCreateRepo(false)}>
                    <Input 
                        placeholder="Nombre del Repositorio (Ej. Docs-Respaldo)" 
                        value={newRepoName} 
                        onChange={(e) => setNewRepoName(e.target.value)} 
                    />
                    <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                        <Button variant="ghost" style={{ flex: '1' }} onClick={() => setShowCreateRepo(false)}>Cancelar</Button>
                        <Button style={{ flex: '1' }} onClick={handleCreateRepository}>Crear</Button>
                    </div>
                </Modal>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%', height: '100%' }}>
            {/* Top Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Button variant="ghost" className="btn-sm" onClick={() => setActiveRepo(null)}>← Volver</Button>
                    <h3 style={{ color: 'var(--text-main)', margin: 0 }}>🏛️ {activeRepo.name}</h3>
                    {activeRepo.originDeviceId && activeRepo.originDeviceId !== (localStorage.getItem('bit_device_id') || 'local') && (
                        <div style={{ display: 'flex', gap: '8px', marginLeft: '10px' }}>
                            <Button variant="ghost" className="btn-sm" style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }} onClick={handlePullRemoteRepo}>
                                📥 Pull
                            </Button>
                            <Button variant="ghost" className="btn-sm" style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--success)', color: 'var(--success)' }} onClick={handlePushRemoteRepo}>
                                📤 Push
                            </Button>
                        </div>
                    )}
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Rama:</span>
                    <select 
                        value={activeBranch} 
                        onChange={(e) => setActiveBranch(e.target.value)}
                        style={{ background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', outline: 'none', cursor: 'pointer' }}
                    >
                        {branches.map(b => (
                            <option key={b.name} value={b.name}>🌿 {b.name}</option>
                        ))}
                    </select>
                    <Button variant="ghost" className="btn-sm" onClick={() => setShowCreateBranch(true)}>+ Nueva Rama</Button>
                </div>
            </div>

            {/* Main Work Area */}
            <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
                
                {/* Left Panel: File Explorer & Staging Area */}
                <Card style={{ width: '280px', flexShrink: 0, padding: '15px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    {/* Explorer Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '10px', gap: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>ARCHIVOS</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <Button variant="ghost" className="btn-sm" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleNewFile}>📄 Nuevo</Button>
                            <Button variant="ghost" className="btn-sm" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => document.getElementById('drive-file-upload')?.click()}>📤 Subir</Button>
                            <input 
                                type="file" 
                                id="drive-file-upload" 
                                multiple 
                                style={{ display: 'none' }} 
                                onChange={handleFileUpload} 
                            />
                        </div>
                    </div>

                    {/* Explorer File List */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {workingFiles.map(file => {
                            const status = getModifiedStatus(file.path);
                            const isSelected = selectedFilePath === file.path;
                            
                            let color = 'var(--text-main)';
                            if (status === 'added') color = 'var(--success)';
                            else if (status === 'modified') color = 'var(--accent-blue)';

                            return (
                                <div 
                                    key={file.path} 
                                    onClick={() => handleSelectFile(file.path)}
                                    style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'center', 
                                        padding: '8px 10px', 
                                        borderRadius: '6px', 
                                        background: isSelected ? 'rgba(255,255,255,0.05)' : 'transparent',
                                        cursor: 'pointer',
                                        border: isSelected ? '1px solid var(--border)' : '1px solid transparent'
                                    }}
                                >
                                    <span style={{ fontSize: '13px', color, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {status === 'added' ? '★ ' : (status === 'modified' ? '✎ ' : '📄 ')} 
                                        {file.path}
                                    </span>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRenameFileClick(file.path); }}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                                            title="Renombrar archivo"
                                        >
                                            ✏️
                                        </button>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.path); }}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                                            title="Eliminar archivo"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            );
                        })}

                        {workingFiles.length === 0 && (
                            <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>
                                Sin archivos. Crea uno nuevo para comenzar.
                            </p>
                        )}
                    </div>

                    {/* Commit Area */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                            <span style={{ color: 'var(--text-dim)' }}>Cambios pendientes:</span>
                            <span style={{ fontWeight: 'bold', color: isDirty ? 'var(--primary)' : 'var(--text-dim)' }}>
                                {changes.length}
                            </span>
                        </div>

                        {isDirty && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', maxHeight: '80px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {changes.map(ch => (
                                    <div key={ch.path} style={{ fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.path}</span>
                                        <span style={{ color: ch.status === 'added' ? 'var(--success)' : (ch.status === 'modified' ? 'var(--accent-blue)' : 'var(--primary)') }}>
                                            {ch.status}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <textarea 
                            placeholder="Mensaje del Commit..." 
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            style={{ width: '100%', height: '50px', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-main)', fontSize: '12px', resize: 'none', outline: 'none' }}
                        />

                        <Button 
                            variant="success" 
                            disabled={!isDirty || !commitMessage.trim()}
                            onClick={handleCommit}
                            style={{ width: '100%', padding: '8px', fontSize: '12px' }}
                        >
                            💾 Hacer Commit
                        </Button>
                    </div>
                </Card>

                {/* Right Panel: Editor / History Tabs */}
                <Card style={{ flex: 1, padding: '15px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    {/* Tab Selection */}
                    <div style={{ display: 'flex', gap: '15px', borderBottom: '1px solid var(--border)', paddingBottom: '8px', flexShrink: 0 }}>
                        <span 
                            onClick={() => setActiveTab('editor')}
                            style={{ fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', color: activeTab === 'editor' ? 'var(--accent-blue)' : 'var(--text-dim)', borderBottom: activeTab === 'editor' ? '2px solid var(--accent-blue)' : '2px solid transparent', paddingBottom: '6px' }}
                        >
                            📄 Editor de Archivos
                        </span>
                        <span 
                            onClick={() => setActiveTab('history')}
                            style={{ fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', color: activeTab === 'history' ? 'var(--accent-blue)' : 'var(--text-dim)', borderBottom: activeTab === 'history' ? '2px solid var(--accent-blue)' : '2px solid transparent', paddingBottom: '6px' }}
                        >
                            📜 Historial de Commits
                        </span>
                        <span 
                            onClick={() => setActiveTab('pullrequests')}
                            style={{ fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', color: activeTab === 'pullrequests' ? 'var(--accent-blue)' : 'var(--text-dim)', borderBottom: activeTab === 'pullrequests' ? '2px solid var(--accent-blue)' : '2px solid transparent', paddingBottom: '6px' }}
                        >
                            🔀 Pull Requests
                        </span>
                        <span 
                            onClick={() => setActiveTab('settings')}
                            style={{ fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', color: activeTab === 'settings' ? 'var(--accent-blue)' : 'var(--text-dim)', borderBottom: activeTab === 'settings' ? '2px solid var(--accent-blue)' : '2px solid transparent', paddingBottom: '6px' }}
                        >
                            ⚙️ Configuración
                        </span>
                    </div>

                    {/* Tab contents */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        
                        {activeTab === 'editor' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                                {selectedFilePath || isCreatingNewFile ? (
                                    <>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                            <span style={{ fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Ruta:</span>
                                            <Input 
                                                placeholder="Ej. carpeta/archivo.txt" 
                                                value={editorPath}
                                                onChange={(e) => setEditorPath(e.target.value)}
                                                style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                                            />
                                        </div>
                                        
                                        {(() => {
                                            const isTooLarge = editorContent.length > 100000;
                                            const isDataURL = editorContent.startsWith('data:');
                                            const isImage = isDataURL && editorContent.startsWith('data:image/');
                                            const sizeKb = Math.round(editorContent.length / 1024);

                                            if (isImage) {
                                                return (
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: '8px', padding: '20px', background: 'var(--input-bg)', overflow: 'hidden' }}>
                                                        <img src={editorContent} alt={editorPath} style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '4px', marginBottom: '10px' }} />
                                                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Vista previa de imagen ({sizeKb} KB)</span>
                                                    </div>
                                                );
                                            }

                                            if (isDataURL) {
                                                return (
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: '8px', padding: '20px', background: 'var(--input-bg)', color: 'var(--text-dim)', gap: '10px' }}>
                                                        <span style={{ fontSize: '32px' }}>📦</span>
                                                        <span style={{ fontSize: '13px', fontWeight: 'bold' }}>Archivo Binario</span>
                                                        <span style={{ fontSize: '11px' }}>Tamaño: {sizeKb} KB. No se puede editar en texto plano.</span>
                                                    </div>
                                                );
                                            }

                                            if (isTooLarge) {
                                                return (
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: '8px', padding: '20px', background: 'var(--input-bg)', color: 'var(--text-dim)', gap: '10px' }}>
                                                        <span style={{ fontSize: '32px' }}>⚠️</span>
                                                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--primary)' }}>Archivo Demasiado Grande</span>
                                                        <span style={{ fontSize: '11px', textAlign: 'center', maxWidth: '280px' }}>
                                                            Este archivo mide {sizeKb} KB. Para prevenir bloqueos de pantalla, la edición directa se ha deshabilitado.
                                                        </span>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <textarea 
                                                    placeholder="Contenido del archivo..." 
                                                    value={editorContent}
                                                    onChange={(e) => setEditorContent(e.target.value)}
                                                    style={{ flex: 1, width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', color: 'var(--text-main)', fontFamily: '"Fira Code", Courier, monospace', fontSize: '13px', outline: 'none', resize: 'none' }}
                                                />
                                            );
                                        })()}

                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                            {isCreatingNewFile && (
                                                <Button variant="ghost" className="btn-sm" onClick={() => setIsCreatingNewFile(false)}>
                                                    Cancelar
                                                </Button>
                                            )}
                                            <Button variant="primary" className="btn-sm" onClick={handleSaveFile}>
                                                Guardar en Borrador
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', gap: '10px' }}>
                                        <span style={{ fontSize: '48px' }}>📝</span>
                                        <p style={{ fontSize: '13px' }}>
                                            Selecciona un archivo para editar o pulsa el botón <strong>Nuevo</strong>.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {commits.map((commit, idx) => (
                                    <div 
                                        key={commit.commitId}
                                        style={{ 
                                            padding: '12px', 
                                            borderRadius: '10px', 
                                            background: 'rgba(255,255,255,0.02)', 
                                            border: '1px solid var(--border)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '6px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--primary)' }}>
                                                {commit.mensaje}
                                            </span>
                                            <span style={{ fontSize: '11px', fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-dim)' }}>
                                                {commit.commitId.substring(0, 7)}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                                            <span>Por: {commit.autor}</span>
                                            <span>{new Date(commit.timestamp).toLocaleString()}</span>
                                        </div>
                                        
                                        {/* Button to checkout/restore files from this commit (simulation) */}
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                                            <Button 
                                                variant="ghost" 
                                                className="btn-sm" 
                                                onClick={async () => {
                                                    const files = await DriveService.checkoutBranch(activeRepo.repoId, activeBranch); // Or load files specifically for this commit
                                                    // In our VCS checkoutBranch checks out branch HEAD. To checkout specific commit:
                                                    const commitObj = await DB.getDriveObject(commit.commitId);
                                                    if (commitObj && commitObj.type === 'commit') {
                                                        const c = JSON.parse(commitObj.content) as Commit;
                                                        const targetFiles: { path: string; content: string }[] = [];
                                                        const traverseTree = async (treeHash: string, currentPath: string): Promise<void> => {
                                                            const treeObj = await DB.getDriveObject(treeHash);
                                                            if (!treeObj || treeObj.type !== 'tree') return;
                                                            const entries = JSON.parse(treeObj.content) as TreeEntry[];
                                                            for (const entry of entries) {
                                                                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                                                                if (entry.type === 'blob') {
                                                                    const blobObj = await DB.getDriveObject(entry.hash);
                                                                    if (blobObj) targetFiles.push({ path: entryPath, content: blobObj.content });
                                                                } else if (entry.type === 'tree') {
                                                                    await traverseTree(entry.hash, entryPath);
                                                                }
                                                            }
                                                        };
                                                        await traverseTree(c.rootTree, '');
                                                        setWorkingFiles(targetFiles);
                                                        setSelectedFilePath(null);
                                                        setEditorPath('');
                                                        setEditorContent('');
                                                        showAlert("Restauración", `Restaurados archivos del commit ${commit.commitId.substring(0, 7)} en tu directorio de trabajo.`);
                                                    }
                                                }}
                                                style={{ fontSize: '10px', padding: '4px 8px' }}
                                            >
                                                🔄 Cargar archivos en directorio de trabajo
                                            </Button>
                                        </div>
                                    </div>
                                ))}

                                {commits.length === 0 && (
                                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>
                                        Sin commits.
                                    </p>
                                )}
                            </div>
                        )}

                        {activeTab === 'settings' && (
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', paddingRight: '4px' }}>
                                {/* Info Card */}
                                <Card style={{ padding: '20px', background: 'rgba(255,255,255,0.01)' }}>
                                    <h4 style={{ margin: '0 0 12px 0', color: 'var(--accent-blue)' }}>📋 Información del Repositorio</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ color: 'var(--text-dim)' }}>ID del Repositorio:</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: '12px', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                                    {activeRepo.repoId}
                                                </span>
                                                <Button 
                                                    variant="ghost" 
                                                    className="btn-sm" 
                                                    style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(activeRepo.repoId);
                                                        showAlert("Copiado", "El ID del repositorio se ha copiado al portapapeles.");
                                                    }}
                                                >
                                                    📋 Copiar
                                                </Button>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-dim)' }}>Creado el:</span>
                                            <span>{new Date(activeRepo.createdAt).toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-dim)' }}>Última modificación:</span>
                                            <span>{new Date(activeRepo.updatedAt).toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-dim)' }}>Total de Ramas:</span>
                                            <span>{branches.length}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-dim)' }}>Total de Commits:</span>
                                            <span>{commits.length}</span>
                                        </div>
                                    </div>
                                </Card>

                                {/* Rename Card */}
                                <Card style={{ padding: '20px', background: 'rgba(255,255,255,0.01)' }}>
                                    <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-main)' }}>✏️ Renombrar Repositorio</h4>
                                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 15px 0' }}>
                                        Cambia el nombre para identificar mejor este repositorio en tu bitDrive.
                                    </p>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <Input 
                                            placeholder="Nuevo nombre del repositorio"
                                            value={repoRenameValue}
                                            onChange={(e) => setRepoRenameValue(e.target.value)}
                                            style={{ flex: 1 }}
                                        />
                                        <Button variant="primary" onClick={handleRenameRepo}>
                                            Guardar
                                        </Button>
                                    </div>
                                </Card>

                                {/* Discard Changes Card */}
                                <Card style={{ padding: '20px', background: 'rgba(255,255,255,0.01)' }}>
                                    <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-main)' }}>🔄 Restaurar Directorio</h4>
                                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 15px 0' }}>
                                        Descarta todos los borradores y cambios sin confirmar, restableciendo el directorio de trabajo al último commit de la rama <strong style={{ color: 'var(--accent-blue)' }}>{activeBranch}</strong>.
                                    </p>
                                    <Button variant="ghost" onClick={handleDiscardLocalChanges}>
                                        Descartar Cambios Locales
                                    </Button>
                                </Card>

                                {/* Danger Zone Card */}
                                <Card style={{ padding: '20px', border: '1px solid rgba(255,0,0,0.2)', background: 'rgba(255,0,0,0.02)' }}>
                                    <h4 style={{ margin: '0 0 12px 0', color: 'var(--primary)' }}>⚠️ Zona de Peligro</h4>
                                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 15px 0' }}>
                                        Eliminar el repositorio borrará permanentemente todas sus ramas, commits y archivos de tu base de datos local. Esta acción es irreversible.
                                    </p>
                                    <Button variant="primary" style={{ background: 'var(--primary)', color: '#fff' }} onClick={handleDeleteRepo}>
                                        Eliminar Repositorio Permanentemente
                                    </Button>
                                </Card>
                            </div>
                        )}

                        {activeTab === 'pullrequests' && (
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', paddingRight: '4px' }}>
                                {!activePR ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <h4 style={{ margin: 0, color: 'var(--text-main)' }}>🔀 Pull Requests</h4>
                                            <Button 
                                                variant="primary" 
                                                className="btn-sm" 
                                                onClick={() => {
                                                    const otherBranch = branches.find(b => b.name !== 'main');
                                                    setNewPRSource(otherBranch ? otherBranch.name : '');
                                                    setNewPRTarget('main');
                                                    setShowCreatePRModal(true);
                                                }}
                                            >
                                                Crear Pull Request
                                            </Button>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                                            {pullRequests.map(pr => (
                                                <div 
                                                    key={pr.prId}
                                                    onClick={async () => {
                                                        setActivePR(pr);
                                                        await loadPRDiffs(pr);
                                                    }}
                                                    style={{ 
                                                        padding: '15px', 
                                                        borderRadius: '10px', 
                                                        background: 'rgba(255,255,255,0.02)', 
                                                        border: '1px solid var(--border)',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>{pr.title}</span>
                                                            <span style={{ 
                                                                fontSize: '10px', 
                                                                fontWeight: 'bold',
                                                                padding: '2px 8px', 
                                                                borderRadius: '12px', 
                                                                background: pr.status === 'open' ? 'rgba(52, 211, 153, 0.1)' : (pr.status === 'merged' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                                                                color: pr.status === 'open' ? 'var(--success)' : (pr.status === 'merged' ? 'var(--accent-blue)' : 'var(--primary)'),
                                                                border: `1px solid ${pr.status === 'open' ? 'rgba(52,211,153,0.3)' : (pr.status === 'merged' ? 'rgba(59,130,246,0.3)' : 'rgba(239,68,68,0.3)')}`
                                                            }}>
                                                                {pr.status.toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                                            #{pr.prId.substring(0, 8)} • De: <strong style={{ color: 'var(--accent-blue)' }}>{pr.sourceBranch}</strong> hacia: <strong style={{ color: 'var(--accent-blue)' }}>{pr.targetBranch}</strong>
                                                        </span>
                                                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                                            Creado por: {pr.author} • {new Date(pr.createdAt).toLocaleString()}
                                                        </span>
                                                    </div>
                                                    <span style={{ fontSize: '18px', color: 'var(--text-dim)' }}>→</span>
                                                </div>
                                            ))}

                                            {pullRequests.length === 0 && (
                                                <div style={{ padding: '30px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '10px', color: 'var(--text-dim)' }}>
                                                    No hay pull requests en este repositorio.
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Button variant="ghost" className="btn-sm" onClick={() => setActivePR(null)}>
                                                ← Volver a la lista
                                            </Button>
                                            <div style={{ display: 'flex', gap: '10px' }}>
                                                {activePR.status === 'open' && (
                                                    <>
                                                        <Button variant="ghost" className="btn-sm" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={() => handleClosePR(activePR)}>
                                                            Cerrar sin Fusionar
                                                        </Button>
                                                        <Button variant="success" className="btn-sm" onClick={() => handleMergePR(activePR)}>
                                                            ✔ Fusionar (Merge)
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        <Card style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.01)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div>
                                                    <h3 style={{ margin: '0 0 4px 0', color: 'var(--text-main)' }}>{activePR.title}</h3>
                                                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                                        ID: {activePR.prId}
                                                    </span>
                                                </div>
                                                <span style={{ 
                                                    fontSize: '11px', 
                                                    fontWeight: 'bold',
                                                    padding: '3px 10px', 
                                                    borderRadius: '12px', 
                                                    background: activePR.status === 'open' ? 'rgba(52, 211, 153, 0.1)' : (activePR.status === 'merged' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                                                    color: activePR.status === 'open' ? 'var(--success)' : (activePR.status === 'merged' ? 'var(--accent-blue)' : 'var(--primary)'),
                                                    border: `1px solid ${activePR.status === 'open' ? 'rgba(52,211,153,0.3)' : (activePR.status === 'merged' ? 'rgba(59,130,246,0.3)' : 'rgba(239,68,68,0.3)')}`
                                                }}>
                                                    {activePR.status.toUpperCase()}
                                                </span>
                                            </div>

                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}>
                                                <span style={{ color: 'var(--text-dim)' }}>Fusión:</span>
                                                <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>{activePR.sourceBranch}</span>
                                                <span style={{ color: 'var(--text-dim)' }}>hacia</span>
                                                <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>{activePR.targetBranch}</span>
                                            </div>

                                            {activePR.description && (
                                                <div style={{ fontSize: '13px', color: 'var(--text-main)', borderTop: '1px solid var(--border)', paddingTop: '12px', whiteSpace: 'pre-wrap' }}>
                                                    <strong>Descripción:</strong><br />
                                                    {activePR.description}
                                                </div>
                                            )}

                                            <div style={{ fontSize: '11px', color: 'var(--text-dim)', borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Autor: {activePR.author}</span>
                                                <span>Creado: {new Date(activePR.createdAt).toLocaleString()}</span>
                                                {activePR.mergedAt && <span>Fusionado: {new Date(activePR.mergedAt).toLocaleString()}</span>}
                                                {activePR.closedAt && <span>Cerrado: {new Date(activePR.closedAt).toLocaleString()}</span>}
                                            </div>
                                        </Card>

                                        {/* PR Comments Card */}
                                        <Card style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.01)' }}>
                                            <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: 'var(--text-main)' }}>
                                                💬 Comentarios ({activePR.comments?.length || 0})
                                            </h4>
                                            
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                                                {activePR.comments && activePR.comments.length > 0 ? (
                                                    activePR.comments.map(c => (
                                                        <div 
                                                            key={c.commentId} 
                                                            style={{ 
                                                                padding: '10px', 
                                                                borderRadius: '8px', 
                                                                background: 'rgba(0,0,0,0.15)', 
                                                                border: '1px solid var(--border)', 
                                                                display: 'flex', 
                                                                flexDirection: 'column', 
                                                                gap: '4px' 
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--accent-blue)' }}>
                                                                <span style={{ fontWeight: 'bold' }}>{c.author}</span>
                                                                <span style={{ color: 'var(--text-dim)' }}>{new Date(c.timestamp).toLocaleString()}</span>
                                                            </div>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-main)', whiteSpace: 'pre-wrap' }}>
                                                                {c.text}
                                                            </span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic', margin: 0 }}>
                                                        No hay comentarios en este pull request.
                                                    </p>
                                                )}
                                            </div>

                                            {activePR.status === 'open' ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                                                    <textarea 
                                                        placeholder="Escribe un comentario..." 
                                                        value={prCommentText} 
                                                        onChange={(e) => setPrCommentText(e.target.value)} 
                                                        style={{ width: '100%', height: '60px', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text-main)', fontSize: '12px', resize: 'none', outline: 'none' }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                        <Button 
                                                            variant="primary" 
                                                            className="btn-sm" 
                                                            onClick={handleAddPRComment} 
                                                            disabled={!prCommentText.trim()}
                                                            style={{ padding: '6px 12px', fontSize: '12px' }}
                                                        >
                                                            Comentar
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center' }}>
                                                    🔒 Este pull request está {activePR.status === 'merged' ? 'fusionado' : 'cerrado'}. No se pueden añadir nuevos comentarios.
                                                </div>
                                            )}
                                        </Card>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <h4 style={{ margin: '10px 0 5px 0', fontSize: '14px', color: 'var(--text-main)' }}>
                                                📁 Archivos cambiados ({prDiffFiles.length})
                                            </h4>
                                            
                                            {prDiffFiles.map(file => {
                                                const isSelected = selectedDiffFile === file.path;
                                                return (
                                                    <div key={file.path} style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                                                        <div 
                                                            onClick={() => setSelectedDiffFile(isSelected ? null : file.path)}
                                                            style={{ 
                                                                display: 'flex', 
                                                                justifyContent: 'space-between', 
                                                                alignItems: 'center', 
                                                                padding: '10px 12px', 
                                                                background: 'rgba(255,255,255,0.01)', 
                                                                cursor: 'pointer',
                                                                fontSize: '13px'
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ 
                                                                    fontSize: '11px', 
                                                                    fontWeight: 'bold', 
                                                                    padding: '2px 6px', 
                                                                    borderRadius: '4px',
                                                                    background: file.status === 'added' ? 'rgba(52,211,153,0.1)' : (file.status === 'modified' ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)'),
                                                                    color: file.status === 'added' ? 'var(--success)' : (file.status === 'modified' ? 'var(--accent-blue)' : 'var(--primary)')
                                                                }}>
                                                                    {file.status}
                                                                </span>
                                                                <span style={{ fontWeight: 'bold' }}>{file.path}</span>
                                                            </div>
                                                            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                                                {isSelected ? '🔼 Ocultar Diff' : '🔽 Mostrar Diff'}
                                                            </span>
                                                        </div>

                                                        {isSelected && (
                                                            <div style={{ 
                                                                borderTop: '1px solid var(--border)', 
                                                                padding: '12px', 
                                                                background: 'rgba(0,0,0,0.2)', 
                                                                fontFamily: '"Fira Code", Courier, monospace', 
                                                                fontSize: '12px', 
                                                                overflowX: 'auto',
                                                                maxHeight: '300px',
                                                                overflowY: 'auto'
                                                            }}>
                                                                {file.status === 'added' && (
                                                                    <pre style={{ margin: 0, color: 'var(--success)' }}>
                                                                        {file.sourceContent || '(Archivo vacío)'}
                                                                    </pre>
                                                                )}
                                                                {file.status === 'deleted' && (
                                                                    <pre style={{ margin: 0, color: 'var(--primary)', textDecoration: 'line-through' }}>
                                                                        {file.targetContent || '(Archivo vacío)'}
                                                                    </pre>
                                                                )}
                                                                {file.status === 'modified' && (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                                        <div style={{ color: 'var(--primary)' }}>
                                                                            <strong>--- Original ({activePR.targetBranch})</strong>
                                                                            <pre style={{ margin: '5px 0 0 0', opacity: 0.7 }}>{file.targetContent}</pre>
                                                                        </div>
                                                                        <div style={{ color: 'var(--success)', borderTop: '1px dashed var(--border)', paddingTop: '10px' }}>
                                                                            <strong>+++ Modificado ({activePR.sourceBranch})</strong>
                                                                            <pre style={{ margin: '5px 0 0 0' }}>{file.sourceContent}</pre>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {prDiffFiles.length === 0 && (
                                                <div style={{ padding: '15px', fontStyle: 'italic', color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center' }}>
                                                    No hay diferencias de archivos entre '{activePR.sourceBranch}' y '{activePR.targetBranch}'.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>
                </Card>

            </div>

            {/* Create Branch Modal */}
            <Modal active={showCreateBranch} title="Crear Rama (Branch)" onClose={() => setShowCreateBranch(false)}>
                <Input 
                    placeholder="Nombre de la Rama (Ej. borrador-documentos)" 
                    value={newBranchName} 
                    onChange={(e) => setNewBranchName(e.target.value)} 
                />
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <Button variant="ghost" style={{ flex: '1' }} onClick={() => setShowCreateBranch(false)}>Cancelar</Button>
                    <Button style={{ flex: '1' }} onClick={handleCreateBranch}>Crear Rama</Button>
                </div>
            </Modal>

            {/* Rename File Modal */}
            <Modal active={showRenameModal} title="Renombrar Archivo" onClose={() => setShowRenameModal(false)}>
                <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                    Original: <strong style={{ color: 'var(--text-main)' }}>{fileToRename}</strong>
                </div>
                <Input 
                    placeholder="Nueva ruta/nombre (Ej. docs/reporte.txt)" 
                    value={renameValue} 
                    onChange={(e) => setRenameValue(e.target.value)} 
                />
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <Button variant="ghost" style={{ flex: '1' }} onClick={() => setShowRenameModal(false)}>Cancelar</Button>
                    <Button style={{ flex: '1' }} onClick={handleRenameFileSubmit}>Renombrar</Button>
                </div>
            </Modal>

            {/* Create PR Modal */}
            <Modal active={showCreatePRModal} title="Crear Pull Request" onClose={() => setShowCreatePRModal(false)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                        <label style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Título</label>
                        <Input 
                            placeholder="Ej. Añadir documentación de bitOS" 
                            value={newPRTitle} 
                            onChange={(e) => setNewPRTitle(e.target.value)} 
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Descripción</label>
                        <textarea 
                            placeholder="Describe los cambios que realizaste en esta rama..." 
                            value={newPRDescription} 
                            onChange={(e) => setNewPRDescription(e.target.value)} 
                            style={{ width: '100%', height: '80px', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text-main)', fontSize: '13px', resize: 'none', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Rama Origen (Source)</label>
                            <select 
                                value={newPRSource} 
                                onChange={(e) => setNewPRSource(e.target.value)}
                                style={{ width: '100%', background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', outline: 'none', cursor: 'pointer' }}
                            >
                                <option value="">Selecciona origen...</option>
                                {branches.map(b => (
                                    <option key={b.name} value={b.name}>🌿 {b.name}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Rama Destino (Target)</label>
                            <select 
                                value={newPRTarget} 
                                onChange={(e) => setNewPRTarget(e.target.value)}
                                style={{ width: '100%', background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', outline: 'none', cursor: 'pointer' }}
                            >
                                {branches.map(b => (
                                    <option key={b.name} value={b.name}>🌿 {b.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <Button variant="ghost" style={{ flex: '1' }} onClick={() => setShowCreatePRModal(false)}>Cancelar</Button>
                        <Button style={{ flex: '1' }} onClick={handleCreatePR} disabled={!newPRTitle.trim() || !newPRSource || !newPRTarget || newPRSource === newPRTarget}>Crear Pull Request</Button>
                    </div>
                </div>
            </Modal>


            {/* Custom popup modal */}
            {popup && (
                <Modal 
                    active={true} 
                    title={popup.title} 
                    onClose={() => {
                        if (popup.type === 'alert') {
                            popup.onConfirm?.();
                        } else {
                            popup.onCancel?.();
                        }
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'pre-wrap', margin: 0 }}>
                            {popup.message}
                        </p>
                        
                        {popup.type === 'prompt' && (
                            <Input 
                                placeholder={popup.placeholder || ''}
                                value={popupPromptValue}
                                onChange={(e) => setPopupPromptValue(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        popup.onConfirm?.(popupPromptValue);
                                    }
                                }}
                            />
                        )}
                        
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '5px' }}>
                            {(popup.type === 'confirm' || popup.type === 'prompt') && (
                                <Button 
                                    variant="ghost" 
                                    onClick={() => popup.onCancel?.()}
                                    style={{ flex: 1 }}
                                >
                                    Cancelar
                                </Button>
                            )}
                            <Button 
                                variant="primary" 
                                onClick={() => {
                                    popup.onConfirm?.(popup.type === 'prompt' ? popupPromptValue : undefined);
                                }}
                                style={{ flex: 1 }}
                            >
                                Aceptar
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};
