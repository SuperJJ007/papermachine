/** Microsoft Fluent Color library glyph; attribution is in THIRD-PARTY-NOTICES.txt. */
import { useId } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** Shared library identity for navigation, guide cards, and resource tabs.
 * @param props - Icon dimensions and layout class.
 * @returns A decorative color library icon with instance-local gradients.
 */
export function ScienceLibraryIcon({ size = 24, className }: IconProps) {
  const id = useId()
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <g fill="none">
        <path fill={`url(#${id}-books)`} d="M5.5 3A1.5 1.5 0 0 1 7 4.5v15A1.5 1.5 0 0 1 5.5 21h-2A1.5 1.5 0 0 1 2 19.5v-15A1.5 1.5 0 0 1 3.5 3z"/>
        <path fill={`url(#${id}-books)`} d="M11.5 3A1.5 1.5 0 0 1 13 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 8 19.5v-15A1.5 1.5 0 0 1 9.5 3z"/>
        <path fill={`url(#${id}-books)`} d="m21.995 18.643l-3.214-12.52a1.5 1.5 0 0 0-1.826-1.08l-1.876.484A1.5 1.5 0 0 0 14 7.353l3.214 12.517a1.5 1.5 0 0 0 1.826 1.08l1.876-.481a1.5 1.5 0 0 0 1.08-1.826"/>
        <path fill={`url(#${id}-bands)`} d="M2 6h5v2H2z"/>
        <path fill={`url(#${id}-bands)`} d="m14.982 11.18l4.785-1.218l-.498-1.937l-4.785 1.218z"/>
        <path fill={`url(#${id}-bands)`} d="M13 6H8v2h5z"/>
        <defs>
          <linearGradient id={`${id}-books`} x1="-1.75" x2="2.7" y1="3" y2="26.492" gradientUnits="userSpaceOnUse">
            <stop stopColor="#43e5ca"/>
            <stop offset="1" stopColor="#2764e7"/>
          </linearGradient>
          <linearGradient id={`${id}-bands`} x1="8" x2="13.97" y1="2.178" y2="4.427" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9ff0f9"/>
            <stop offset="1" stopColor="#6ce0ff"/>
          </linearGradient>
        </defs>
      </g>
    </svg>
  )
}
