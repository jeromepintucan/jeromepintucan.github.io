<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  // Get the form data
  $name = $_POST['name'];
  $email = $_POST['email'];
  $message = $_POST['message'];

  // Create the email body
  $body = "Name: $name\n\nEmail: $email\n\nMessage:\n$message";

  // Send the email
  $to = 'your-email@example.com';
  $subject = 'New message from website';
  $headers = 'From: webmaster@example.com';
  mail($to, $subject, $body, $headers);
}
