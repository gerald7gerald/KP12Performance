const word = document.querySelector(".shop-word");

document.addEventListener("mousemove",(e)=>{

const x=(e.clientX/window.innerWidth-.5)*30;

const y=(e.clientY/window.innerHeight-.5)*30;

word.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;

});