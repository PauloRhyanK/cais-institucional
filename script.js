function start() {
  showMobileMenu();
  checkDevice();
  showDropDownMenu();
  submitToast();
}

async function submitToast() {
  const formEl = document.getElementById("contactForm");
  const feedbackEl = document.getElementById("submitResponse");
  const contentFeedback = document.getElementById("contentFeedback");
  formEl.addEventListener("submit", (event) => {
    feedbackEl.style.filter = "opacity(1)";
    contentFeedback.style.filter = "opacity(1)";
    feedbackEl.style.height = "5rem";
    feedbackEl.style.padding = "1rem 2rem";
    setTimeout(() => {
      feedbackEl.style.filter = "opacity(0)";
      feedbackEl.style.height = "0rem";
      contentFeedback.style.filter = "opacity(0)";
      feedbackEl.style.padding = "0rem";
      formEl.reset();
    }, 5000);
  });
}
const checkDevice = () => {
  const userAgent = navigator.userAgent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i;

  if (isMobile.test(userAgent)) {
    console.log("Using mobile device");
  } else {
    console.log("Using desktop device");
  }
};

function showDropDownMenu() {
  const dropBtn = document.getElementById("dropBtn");
  const dropDown = document.getElementById("dropDown");
  const dropDownContent = document.getElementById("dropDownContent");

  dropBtn.addEventListener("mouseenter", () => {
    dropDown.style.height = "14rem";
    dropDown.style.filter = "opacity(1)";
    dropDownContent.style.filter = "opacity(1)";
    dropDown.style.backdropFilter = "blur(10px)";
  });
  dropBtn.addEventListener("mouseleave", () => {
    dropDown.style.height = "0rem";
    dropDown.style.filter = "opacity(0)";
    dropDown.style.backdropFilter = "blur(0)";
    dropDownContent.style.filter = "opacity(0)";
  });
}
function showMobileMenu() {
  const mobileBtn = document.getElementById("mobileBtn");
  const mobileMenuContent = document.getElementById("mobileMenuContent");

  mobileBtn.addEventListener("click", () => {
    mobileMenuContent.classList.toggle("active");
    mobileBtn.classList.toggle("close");
  });
}
start();
