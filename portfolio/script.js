var btnLogin = document.getElementById('do-login');
var idLogin = document.getElementById('login');
var username = document.getElementById('username');
btnLogin.onclick = function(){
        var username = document.getElementById("username").value;
        var password = document.getElementById("password").value;

        if (username === "admin" && password === "adminpassword") {
            idLogin.innerHTML = '<p>We\'re happy to see you again, </p><h1>' +username.value+ '</h1>';
            window.location.href = "OtherWorks.html";
        } else {
            alert("Unauthorized access! You can contact Jerome Pintucan for assistance");
        }
  idLogin.innerHTML = '<p>We\'re happy to see you again, </p><h1>' +username.value+ '</h1>';
}
