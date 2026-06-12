import { RPCError } from '../errors/RPCError.ts';

/**
 * Valida que un paquete contenga los campos requeridos y devuelve un objeto con los campos seleccionados.
 * @param packet El paquete RPC (ctx.paquete)
 * @param requiredFields Lista de campos obligatorios
 * @param optionalFields Lista de campos opcionales que se desean extraer si existen
 * @returns Un objeto con los campos requeridos y opcionales tipado
 * @throws RPCError si falta algún campo requerido
 */
export function validateFields<T>(packet: any, requiredFields: (keyof T)[], optionalFields: (keyof T)[] = []): T {
    if (!packet || typeof packet !== 'object') {
        throw new RPCError('INVALID_PACKAGE', 'El paquete es inválido o está vacío', false);
    }

    const validated: any = {};
    const missingFields: string[] = [];

    for (const field of requiredFields) {
        const value = packet[field as string];
        if (value === undefined || value === null) {
            missingFields.push(String(field));
        } else {
            validated[field] = value;
        }
    }

    if (missingFields.length > 0) {
        throw new RPCError(
            'INVALID_PARAMS', 
            `Faltan campos requeridos: ${missingFields.join(', ')}`,
            false
        );
    }

    for (const field of optionalFields) {
        const value = packet[field as string];
        if (value !== undefined && value !== null) {
            validated[field] = value;
        }
    }

    return validated as T;
}
