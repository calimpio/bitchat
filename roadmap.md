# 🗺️ bitOS Roadmap

Este documento detalla el progreso del desarrollo de bitOS y las metas futuras para la terminal de soberanía criptográfica.

## ✅ Hitos Completados

### 🏗️ Arquitectura y Core
- [x] **Migración a TypeScript**: Refactorización completa del código base monolítico a un sistema modular y tipado.
- [x] **SDK Local-First**: Abstracción de servicios core:
    - `DB`: Gestión de base de datos relacional local con IndexedDB.
    - `Auth`: Lógica criptográfica SHA-256 para identidades autónomas.
    - `Peer`: Networking P2P robusto utilizando PeerJS y WebRTC.
- [x] **Soporte Multi-Terminal**: Implementación de `deviceId` persistente y sufijos de Peer dinámicos para permitir múltiples sesiones simultáneas con la misma identidad.
- [x] **Sistema de Tipado Fuerte**: Implementación de uniones discriminadas para paquetes de datos de red (`IPaqueteData`).
- [x] **Gestión de Estado Reactiva**: Estado global centralizado y tipado para una UI predecible.
- [x] **Seguridad Avanzada**:
    - [x] **Cifrado E2EE**: Mensajería de extremo a extremo (ECDH + AES-GCM).
    - [x] **Persistencia Cifrada**: Base de datos IndexedDB protegida con Contraseña Maestra.
    - [x] **Protocolo de Migración**: Automatización para cifrar mensajes antiguos y actualizar identidades legadas.

### 🎨 Interfaz de Usuario (UI)
- [x] **Micro-Componentes Funcionales**: Creación de una biblioteca interna de componentes (`Button`, `Input`, `Card`, `Modal`).
- [x] **Navegación por Estados**: Sistema de páginas (`Auth`, `Dashboard`, `Terms`) gestionado por el estado de la aplicación.
- [x] **Diseño Responsivo**: Interfaz adaptativa optimizada para escritorio y dispositivos móviles (Popup Chat).
- [x] **Página de Términos y Licencia**: Integración legal y declaración de Licencia MIT dentro de la app.

### ⚙️ Automatización y DevOps
- [x] **Pipeline de Windows**: Scripts automatizados para:
    - Sincronización de assets (`sync.cjs`).
    - Compilación nativa y empaquetado ZIP (`build.cjs`).
    - Actualización automática de manifiestos Winget (SHA256).
- [x] **Bundler Standalone**: Script `single.cjs` para generar un único archivo `bitmsg.html` con todos los recursos inyectados (Inlining).
- [x] **Hosting Web**: Despliegue automático a GitHub Pages.

## 🚀 Próximos Pasos (Próximamente)

### 📱 Mejoras de UX
- [ ] **Notificaciones Push**: Soporte para notificaciones nativas cuando la terminal está en segundo plano.
- [ ] **Multimedia P2P**: Soporte para envío de imágenes y archivos pequeños directamente entre pares.
- [ ] **Indicadores de Escritura**: Visualización en tiempo real cuando el contacto está escribiendo.

### 🌐 Ecosistema
- [ ] **bitDevices**: Gestión y orquestación de terminales personales:
    - [ ] **Inventario de Nodos**: Visualización de todos los dispositivos vinculados a la misma identidad.
    - [ ] **Sincronización en Tiempo Real**: Mantenimiento automático de estados y mensajes entre dispositivos online.
    - [ ] **Control Granular**: Capacidad de seleccionar qué dispositivos específicos deben sincronizarse y cuáles deben permanecer aislados o con acceso restringido.
- [ ] **bitDrive**: Sistema de almacenamiento de archivos soberano integrado:
    - [ ] **Almacenamiento Privado**: Espacio seguro para archivos personales cifrados localmente.
    - [ ] **Sincronización Multi-Dispositivo**: Transferencia P2P de archivos entre terminales del mismo dueño.
    - [ ] **Control de Repositorios**: Capacidad de seleccionar qué repositorios o carpetas específicas se comparten con qué dispositivos, permitiendo un control total sobre la distribución de datos.
    - [ ] **Versionado y Ramas**: Sistema de control de versiones tipo "Git" para archivos, con soporte para ramas y estados históricos.
- [ ] **Dockerización**: Contenedor para facilitar el auto-alojamiento de la versión web.
- [ ] **App Móvil Nativa**: Exploración de portabilidad a Android/iOS usando Capacitor o similar.

---
*Última actualización: 7 de junio de 2026*
