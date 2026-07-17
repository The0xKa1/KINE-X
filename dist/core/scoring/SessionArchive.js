                                                           

                                  
             
                     
                       
                     
                
               
                    
                        
                   
                   
                    
                          
 

const STORAGE_KEY = "kinex.sessions.v1";
const MAX_SESSIONS = 20;

/**
 * localStorage-backed history of finished sessions (newest first, capped at
 * 20). Powers the report page and the library's history stats. Best-effort:
 * any storage failure just means no history.
 */
export class SessionArchive {
  list()                    {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw)                     ;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  latest()                         {
    return this.list()[0] ?? null;
  }

  get(id        )                         {
    return this.list().find((session) => session.id === id) ?? null;
  }

  add(entry                 )       {
    const sessions = [entry, ...this.list().filter((s) => s.id !== entry.id)].slice(0, MAX_SESSIONS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // storage full or unavailable — history is best-effort
    }
  }

  /** Sessions played for one exercise, newest first. */
  forExercise(exerciseId        )                    {
    return this.list().filter((s) => s.exerciseId === exerciseId);
  }
}
