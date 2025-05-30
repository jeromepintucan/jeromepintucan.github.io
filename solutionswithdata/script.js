const navLinks = document.querySelectorAll('.nav-menu .nav-link');
const menuOpenButton = document.querySelector('#menu-open-button');
const menuCloseButton = document.querySelector('#menu-close-button');

menuOpenButton.addEventListener("click", () => {
    document.body.classList.toggle("show-mobile-menu")
});

// Close the menu when a close button is clicked
menuCloseButton.addEventListener("click", () =>  menuOpenButton.click());

// Close the menu when a nav is clicked
navLinks.forEach(link => {
  link.addEventListener("click", () => menuOpenButton.click());
});

// Initializing Swiper
const swiper = new Swiper('.slider-wrapper', {
  loop: true,
  grabCursor: true,
  spaceBetween: 25,


  // If we need pagination
  pagination: {
    el: '.swiper-pagination',
    clickable: true,
    dynamicBullets: true,
  },

  // Navigation arrows
  navigation: {
    nextEl: '.swiper-button-next',
    prevEl: '.swiper-button-prev',
  },

  // Responsive breakpoints
  breakpoints: {
    0: {
        slidesPerView: 1,
    },
    768: {
        slidesPerView: 2
    },
    1024: {
        slidesPerView: 3,
    }
  }
});


// Modal Project Preview
const modal = document.getElementById('project-modal');
const swiperWrapper = document.getElementById('project-swiper-wrapper');
const closeModal = document.querySelector('.close-modal');

const projectImages = {
    insurance: ['images/INSURANCE DASHBOARD.png', 'images/INSURANCE2.png'],
    project2: ['images/ai_pipeline.png'],
    project3: ['images/ai_pipeline.png'],
    project4: ['images/ai_pipeline.png'],
    project5: ['images/ai_pipeline.png'],
    project6: ['images/ai_pipeline.png'],
};

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const projectKey = item.getAttribute('data-project');
      const images = projectImages[projectKey] || [];

      swiperWrapper.innerHTML = images.map(img => `
        <div class="swiper-slide">
          <img src="${img}" alt="${projectKey}" style="width: 100%; height: auto;" />
        </div>
      `).join('');

      modal.style.display = 'block';

      new Swiper('.project-swiper', {
        navigation: {
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev',
        },
        pagination: {
          el: '.swiper-pagination',
        },
      });
    });
  });

  closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });


  // Security
document.addEventListener('DOMContentLoaded', function () {
  // Disable right-click
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  // Disable DevTools shortcuts
  document.addEventListener('keydown', function (e) {
    const key = e.key.toLowerCase();
    const code = e.code;

    // Common blocked keys and combos
    if (
      code === 'F12' ||                                // F12
      (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key)) || // Ctrl+Shift+I/J/C
      (e.ctrlKey && key === 'u') ||                    // Ctrl+U
      (e.ctrlKey && key === 's') ||                    // Ctrl+S
      (e.ctrlKey && key === 'p') ||
      (e.ctrlKey && key === 'a') ||
      (e.ctrlKey && key === 'c') ||                    // Ctrl+P
      (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key))       // Cmd+Opt+I/J/C for Mac
    ) {
      e.preventDefault();
    }
  });
});

const JavaScriptObfuscator = require('javascript-obfuscator');

const obfuscatedCode = JavaScriptObfuscator.obfuscate(
  myJavaScriptCode,
  {
    compact: true,
    controlFlowFlattening: true
  }
).getObfuscatedCode();





