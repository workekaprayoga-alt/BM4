(function(){
  try {
    if(location.search.indexOf('desktop=1') > -1) return;
    var isMobileSize = window.innerWidth < 768;
    var isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if(isMobileSize || isMobileUA){
      location.replace('mobile.html' + (location.search || ''));
    }
  } catch(e){}
})();
