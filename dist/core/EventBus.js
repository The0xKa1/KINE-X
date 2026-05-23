                                                                                  

                                                                                               

                                     
                        
                  
 

                            
                              
                                    
                            
                                                                               
                                     
 

                                           
                                                                                      

export class EventBus {
          listeners                                                                    ;

  constructor() {
    this.listeners = new Map();
  }

  on                        (event   , handler                    )             {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(handler                                              );
    this.listeners.set(event, bucket);

    return () => bucket.delete(handler                                              );
  }

  emit                        (event   , payload              )       {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.forEach((handler) => handler(payload));
  }
}
