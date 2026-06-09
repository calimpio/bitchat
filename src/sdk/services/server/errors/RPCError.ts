export class RPCError extends Error {
    constructor(
        public code: string, 
        message: string, 
        public closeConnection: boolean = false
    ) {
        super(message);
        this.name = 'RPCError';
    }
}
