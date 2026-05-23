                                                                    

                           
                                 
                                   
                                
                       
                                 
                                
                               
                                  
                                    
                    
                   
                                       
                                       
                                         
                                     
                                  
                         
 

export class AppShell {
          options                 ;
          playing = true;

  constructor(options                 ) {
    this.options = options;
    this.bind();
    this.renderPlayIcon();
  }

  setProgress(progress        )       {
    this.options.timeSlider.value = String(Math.round(progress * 1000));
  }

  setPlaying(playing         , notify          = true)       {
    if (this.playing === playing) return;
    this.playing = playing;
    this.renderPlayIcon();
    if (notify) this.options.onPlayChange(playing);
  }

  isPlaying()          {
    return this.playing;
  }

          bind()       {
    this.options.railItems.forEach((button) => {
      button.addEventListener("click", () => {
        this.options.railItems.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        const nav = button.dataset.nav;
        if (nav === "seed") this.options.onNavMode("coach");
        else if (nav === "compare") this.options.onNavMode("stress");
        else if (nav === "rebuild") this.options.onRebuild();
        else if (nav === "score") this.options.onSafety();
      });
    });

    this.options.viewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.options.viewButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        this.options.onViewChange(button.dataset.view              );
      });
    });

    this.options.playButton.addEventListener("click", () => {
      this.setPlaying(!this.playing);
    });

    this.options.stressToggle.addEventListener("change", () => this.options.onStressChange(this.options.stressToggle.checked));
    this.options.speedSlider.addEventListener("input", () => this.options.onSpeedChange(Number(this.options.speedSlider.value) / 100));
    this.options.timeSlider.addEventListener("input", () => {
      this.setPlaying(false);
      this.options.onScrub(Number(this.options.timeSlider.value) / 1000);
    });
    this.options.cameraButton.addEventListener("click", () => this.options.onCameraToggle());
  }

          renderPlayIcon()       {
    this.options.playIcon.innerHTML = this.playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" />'
      : '<path d="m8 5 11 7-11 7V5Z" />';
  }
}
