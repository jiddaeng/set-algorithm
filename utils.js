const DEBOUNCE_DELAY = 300;
let delcnt = 0;

function hideVideo(video) {
    // video.style.display = "none";
    video.dataset.saProcessed = "1";
    setTimeout(() => {
            video.remove();
            delcnt++;
        }, 50);
}