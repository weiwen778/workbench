import { useEffect, useRef, useState } from 'react'
import { Button } from '@mui/material'
import { ArrowRight } from '@/icons'

export default function MemoContent({ content, onExpand }: { content: string; onExpand: () => void }) {
  const body = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const measure = () => {
      if (!body.current) return
      setOverflows(body.current.scrollHeight > body.current.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (body.current) observer.observe(body.current)
    return () => observer.disconnect()
  }, [content])

  return (
    <div className="memo-body" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        ref={body}
        className="memo-content collapsed"
        style={{
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 6,
          maxHeight: '11.1em', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        }}
      >
        {content}
      </div>
      {overflows ? (
        <Button size="small" onClick={onExpand} sx={{ alignSelf: 'flex-start', fontSize: 12, color: 'text.secondary', px: 1 }}>
          查看全文<ArrowRight sx={{ fontSize: 14, ml: 0.5 }} />
        </Button>
      ) : null}
    </div>
  )
}
