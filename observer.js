function createObserver(callback) {
    let debounceTimer = null;

    function run() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(callback, DEBOUNCE_DELAY);
    }

    const observer = new MutationObserver(run);
    const target = document.body || document.documentElement;

    if (target) {
        observer.observe(target, {
            childList: true,
            subtree: true
        });
    }

    run();

    return observer;
}