export function validar(schema, data, res) {
    const result = schema.safeParse(data ?? {});
    if (!result.success) {
        res.status(400).json({
            error: "Dados inválidos",
            details: result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message
            }))
        });
        return null;
    }
    return result.data;
}