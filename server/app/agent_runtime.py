"""Internal-only execution context for authenticated Agent reads and reviewed writes."""
from contextvars import ContextVar
from dataclasses import dataclass
from sqlalchemy.orm import Session

@dataclass
class AgentExecution:
    user_id: int
    actor: str
    db: Session

execution: ContextVar[AgentExecution | None] = ContextVar('agent_execution', default=None)

class AgentSession(Session):
    # Existing business handlers can flush, but only the review coordinator commits.
    def commit(self):
        self.flush()