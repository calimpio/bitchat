import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { DriveService, DB } from '../../sdk/index.ts';
import { Repository, Branch, Commit, TreeEntry } from '../../sdk/models/drive.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

export const DriveView: React.FC = () => {
    const { me } = useStore();
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
    const [activeTab, setActiveTab] = useState<'editor' | 'history'>('editor');

    // Modals
    const [showCreateRepo, setShowCreateRepo] = useState(false);
    const [newRepoName, setNewRepoName] = useState('');
    const [showCreateBranch, setShowCreateBranch] = useState(false);
    const [newBranchName, setNewBranchName] = useState('');

    // Rename state
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [fileToRename, setFileToRename] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

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
        }
    }, [activeRepo, activeBranch]);

    const handleCreateRepository = async () => {
        if (!newRepoName.trim()) return alert("El nombre es requerido");
        try {
            const repo = await DriveService.createRepository(newRepoName.trim());
            setNewRepoName('');
            setShowCreateRepo(false);
            await loadRepositories();
            setActiveRepo(repo);
            setActiveBranch('main');
        } catch (e) {
            alert("Error al crear el repositorio");
        }
    };

    const handleCreateBranch = async () => {
        if (!activeRepo) return;
        if (!newBranchName.trim()) return alert("El nombre es requerido");
        try {
            const cleanName = newBranchName.trim().replace(/\s+/g, '-');
            await DriveService.createBranch(activeRepo.repoId, cleanName);
            setNewBranchName('');
            setShowCreateBranch(false);
            await loadRepoData(activeRepo, cleanName);
        } catch (e: any) {
            alert(e.message || "Error al crear la rama");
        }
    };

    const handleSaveFile = () => {
        if (!editorPath.trim()) return alert("La ruta del archivo es requerida");
        
        const path = editorPath.trim();
        const updated = [...workingFiles];

        if (!isCreatingNewFile && selectedFilePath) {
            // Rename/update existing file
            const idx = updated.findIndex(f => f.path === selectedFilePath);
            if (idx !== -1) {
                // If they changed the name to something else that already exists, warn them
                const collisionIdx = updated.findIndex((f, i) => f.path === path && i !== idx);
                if (collisionIdx !== -1) {
                    return alert("Ya existe un archivo con ese nombre.");
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
        alert("Archivo guardado en el directorio de trabajo.");
    };

    const handleDeleteFile = (path: string) => {
        if (confirm(`¿Eliminar ${path} del directorio de trabajo?`)) {
            const updated = workingFiles.filter(f => f.path !== path);
            setWorkingFiles(updated);
            if (selectedFilePath === path) {
                setSelectedFilePath(null);
                setEditorPath('');
                setEditorContent('');
            }
        }
    };

    const handleRenameFileClick = (path: string) => {
        setFileToRename(path);
        setRenameValue(path);
        setShowRenameModal(true);
    };

    const handleRenameFileSubmit = () => {
        if (!fileToRename) return;
        const newPath = renameValue.trim();
        if (!newPath) return alert("El nombre/ruta del archivo no puede estar vacío");
        if (newPath === fileToRename) {
            setShowRenameModal(false);
            return;
        }

        const updated = [...workingFiles];
        const collisionIdx = updated.findIndex(f => f.path === newPath);
        if (collisionIdx !== -1) {
            return alert("Ya existe un archivo con ese nombre.");
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
            alert("Archivo renombrado con éxito.");
        }
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
                    alert(`${total} archivo(s) subido(s) al directorio de trabajo.`);
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
        if (!commitMessage.trim()) return alert("El mensaje del commit es requerido");
        if (workingFiles.length === 0) {
            const proceed = confirm("El commit estará vacío. ¿Continuar?");
            if (!proceed) return;
        }

        try {
            await DriveService.createCommit(activeRepo.repoId, activeBranch, commitMessage.trim(), workingFiles);
            setCommitMessage('');
            alert("Commit creado con éxito.");
            await loadRepoData(activeRepo, activeBranch);
        } catch (e: any) {
            alert(e.message || "Error al procesar el commit");
        }
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
                    <Button variant="primary" onClick={() => setShowCreateRepo(true)}>📁 Nuevo Repositorio</Button>
                </div>

                <p style={{ color: 'var(--text-dim)', fontSize: '14px', textAlign: 'center' }}>
                    Versionador de archivos descentralizado tipo Git. Crea un repositorio para empezar a almacenar e importar tus carpetas.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px', marginTop: '10px' }}>
                    {repositories.map(repo => (
                        <Card key={repo.repoId} style={{ padding: '20px', cursor: 'pointer' }} onClick={() => { setActiveRepo(repo); setActiveBranch('main'); }}>
                            <h4 style={{ color: 'var(--accent-blue)', fontSize: '16px', marginBottom: '8px' }}>🏛️ {repo.name}</h4>
                            <p style={{ fontSize: '11px', color: 'var(--text-dim)', wordBreak: 'break-all' }}>ID: {repo.repoId}</p>
                            <div style={{ borderTop: '1px solid var(--border)', marginTop: '15px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                                <span>Creado: {new Date(repo.createdAt).toLocaleDateString()}</span>
                                <span>Activo</span>
                            </div>
                        </Card>
                    ))}
                </div>

                {repositories.length === 0 && (
                    <Card style={{ padding: '40px', borderStyle: 'dashed', background: 'transparent', textAlign: 'center' }}>
                        <p style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                            No se han encontrado repositorios. Inicializa uno para gestionar tus archivos y respaldos.
                        </p>
                        <Button variant="ghost" style={{ margin: '0 auto' }} onClick={() => setShowCreateRepo(true)}>Inicializar Primer Repositorio</Button>
                    </Card>
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
                    </div>

                    {/* Tab contents */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        
                        {activeTab === 'editor' ? (
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
                        ) : (
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
                                                        alert(`Restaurados archivos del commit ${commit.commitId.substring(0, 7)} en tu directorio de trabajo.`);
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
        </div>
    );
};
