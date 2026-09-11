/** Unchanged artifact identities and the additional constraints for file materialization. */

/**
 * Whether a logical name is an unchanged, forward-slash relative artifact identity.
 * Device names and trailing dots remain readable in historical metadata; materialization checks them separately.
 * @param value - Untrusted logical name.
 * @returns Whether the name contains well-formed, non-traversing path segments.
 */
export function isScienceLogicalName(value: string): boolean {
  return value.length > 0 && value.length <= 4096 && value.isWellFormed()
    && !/[\u0000-\u001f\u007f-\u009f<>:"|?*\\]/.test(value)
    && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

/**
 * Whether an artifact identity can be materialized without Windows device or trailing-name aliases.
 * @param value - Untrusted run-relative file destination.
 * @returns Whether the unchanged destination is portable across supported hosts.
 */
export function isScienceMaterializationPath(value: string): boolean {
  return isScienceLogicalName(value) && value.split('/').every(segment => !/[. ]$/.test(segment)
    && !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(segment))
}
